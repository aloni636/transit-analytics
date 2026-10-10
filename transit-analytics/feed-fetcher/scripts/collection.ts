import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parse } from "yaml";
import { realtimeFeeds, type RealtimeFeedKey } from "@transit-analytics/shared/feeds";

const [command, ...arguments_] = process.argv.slice(2);
const [manifestPath] = arguments_;
if (command === "start" || command === "smoke") {
  if (!arguments_.length || new Set(arguments_).size !== arguments_.length ||
    arguments_.some((key) => !Object.hasOwn(realtimeFeeds, key))) {
    throw new Error("Supply unique realtime feed keys: pnpm collection " + command + " <FEED_KEY> [FEED_KEY ...]");
  }
}
const region = process.env.AWS_REGION ?? "eu-central-1";
function aws(service: string, action: string, ...args: string[]) {
  return JSON.parse(execFileSync("aws", [service, action, ...args,
    "--region", region,
    "--output", "json", "--no-cli-pager"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) || "{}");
}

if (command === "validate") {
  const template = await readFile(new URL("../../../infra/modules/transit-analytics/realtime-feed-workflow.asl.yaml", import.meta.url), "utf8");
  const minimums = JSON.stringify(Object.fromEntries(Object.entries(realtimeFeeds).map(
    ([key, feed]) => [key, feed.minimumPollIntervalSeconds],
  )));
  const definition = parse(template.replace(/\$\{realtime_minimums\}/, minimums)
    .replace(/\$\{realtime_fetcher_arn\}/, "arn:aws:lambda:" + region + ":123456789012:function:realtime"));
  const directory = await mkdtemp(join(tmpdir(), "gtfs-workflow-"));
  try {
    const path = join(directory, "workflow.json");
    await writeFile(path, JSON.stringify(definition));
    const result = aws("stepfunctions", "validate-state-machine-definition", "--definition", "file://" + path, "--type", "STANDARD", "--severity", "WARNING");
    console.log(JSON.stringify(result, null, 2));
    if (result.result !== "OK") process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true });
  }
} else if (["smoke", "start", "test-notifications", "notifications"].includes(command)) {
  const outputs = JSON.parse(execFileSync("terraform", [
    "-chdir=../../infra/environments/dev", "output", "-json",
  ], { encoding: "utf8" }));
  if (command === "test-notifications") {
    const alarm = outputs.notification_test_alarm_name.value;
    aws("cloudwatch", "set-alarm-state", "--alarm-name", alarm, "--state-value", "OK", "--state-reason", "Prepare phone delivery test");
    aws("cloudwatch", "set-alarm-state", "--alarm-name", alarm, "--state-value", "ALARM", "--state-reason", "GTFS collection phone delivery verification");
    console.log("Test alarm sent. Check AWS Console Mobile push, then run pnpm collection notifications to inspect AWS-side events.");
  } else if (command === "notifications") {
    const result = aws("notifications", "list-notification-events",
      "--source", "aws.cloudwatch", "--start-time", new Date(Date.now() - 3600_000).toISOString());
    console.log(JSON.stringify(result.notificationEvents.filter((event: any) =>
      event.notificationConfigurationArn === outputs.notification_configuration_arn.value,
    ), null, 2));
  } else {
    let startedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    let stopAt = new Date(Date.parse(startedAt) + (command === "smoke" ? 120 : 172800) * 1000).toISOString();
    const collectionName = "collection-" + randomUUID();
    const staticKeys = [...new Set(arguments_.map((key) => realtimeFeeds[key as RealtimeFeedKey].staticFeedKey))];
    const schedules = staticKeys.map((feedKey, index) => {
      const template = outputs.static_feed_schedules?.value[feedKey];
      if (!template) throw new Error("Missing static schedule template for " + feedKey + "; redeploy Terraform outputs.");
      const source = aws("scheduler", "get-schedule", "--name", template.name, "--group-name", template.groupName);
      if (!/^(cron|rate)\(/.test(source.ScheduleExpression)) throw new Error("Static template must be recurring: " + template.name);
      return {
        Name: collectionName + "-" + index,
        GroupName: template.groupName,
        ScheduleExpression: source.ScheduleExpression,
        ScheduleExpressionTimezone: source.ScheduleExpressionTimezone,
        FlexibleTimeWindow: source.FlexibleTimeWindow,
        KmsKeyArn: source.KmsKeyArn,
        State: "ENABLED", StartDate: startedAt, EndDate: stopAt, ActionAfterCompletion: "DELETE",
        Target: {
          ...source.Target,
          Input: JSON.stringify({ ...JSON.parse(source.Target.Input), stopAt }),
          RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 },
        },
      };
    });
    const manifest = {
      region, startedAt, stopAt, pollingSeconds: 60,
      feedKeys: arguments_,
      bucket: outputs.data_lake_bucket.value as string,
      alarmPrefix: outputs.realtime_fetcher_function_name.value as string,
      stateMachineArn: outputs.realtime_feed_workflow_arn.value as string,
      executionArn: "",
      initialStaticExecutions: [] as { feedKey: string; executionArn: string }[],
      staticSchedules: schedules.map((schedule, index) => ({
        feedKey: staticKeys[index], name: schedule.Name, groupName: schedule.GroupName, arn: "",
      })),
    };
    await mkdir(".collections", { recursive: true });
    const path = ".collections/" + collectionName + ".json";
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    console.log("Collection manifest: " + path);
    // Fetch archives sequentially so they do not compete for one Lambda's temporary disk.
    for (const [index, feedKey] of staticKeys.entries()) {
      const initial = aws("stepfunctions", "start-execution",
        "--state-machine-arn", outputs.static_feed_workflow_arn.value,
        "--name", collectionName + "-initial-" + index,
        "--input", JSON.stringify({ feedKeys: [feedKey], scheduledTime: new Date().toISOString() }));
      manifest.initialStaticExecutions.push({ feedKey, executionArn: initial.executionArn });
      await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
      console.log(JSON.stringify({ initialStaticFeed: feedKey, executionArn: initial.executionArn }));
      let execution = aws("stepfunctions", "describe-execution", "--execution-arn", initial.executionArn);
      while (execution.status === "RUNNING") {
        await setTimeout(5_000);
        execution = aws("stepfunctions", "describe-execution", "--execution-arn", initial.executionArn);
      }
      if (execution.status !== "SUCCEEDED") throw new Error("Initial static snapshot failed for " + feedKey + ": " + execution.status + ". Realtime collection was not started; inspect " + path);
    }
    startedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    stopAt = new Date(Date.parse(startedAt) + (command === "smoke" ? 120 : 172800) * 1000).toISOString();
    Object.assign(manifest, { startedAt, stopAt });
    for (const schedule of schedules) {
      schedule.StartDate = startedAt;
      schedule.EndDate = stopAt;
      schedule.Target.Input = JSON.stringify({ ...JSON.parse(schedule.Target.Input), stopAt });
    }
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
    const result = aws("stepfunctions", "start-execution",
      "--state-machine-arn", manifest.stateMachineArn,
      "--name", collectionName,
      "--input", JSON.stringify({ feedKeys: manifest.feedKeys, pollingSeconds: 60, stopAt }));
    manifest.executionArn = result.executionArn;
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
    console.log(JSON.stringify({ feedKeys: manifest.feedKeys, executionArn: result.executionArn, stopAt }));
    for (const [index, schedule] of schedules.entries()) {
      let created;
      try {
        created = aws("scheduler", "create-schedule", "--cli-input-json", JSON.stringify(schedule));
      } catch (error) {
        console.error("Partial collection launch. Inspect " + path + "; stop realtime and remove temporary schedules with pnpm collection stop " + path);
        throw error;
      }
      manifest.staticSchedules[index].arn = created.ScheduleArn;
      await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
      console.log(JSON.stringify(manifest.staticSchedules[index]));
    }
  }
} else if ((command === "status" || command === "stop") && manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (region !== manifest.region) throw new Error("Set AWS_REGION to " + manifest.region);
  const report: Record<string, unknown>[] = [];
  const endMs = Math.min(Date.now(), Date.parse(manifest.stopAt));
  let current = manifest.executionArn;
  let execution: any;
  const chain: string[] = [];
  while (current) {
    chain.push(current);
    execution = aws("stepfunctions", "describe-execution", "--execution-arn", current);
    const output = execution.output ? JSON.parse(execution.output) : {};
    const child = output.ExecutionArn ?? output.executionArn;
    if (execution.status !== "SUCCEEDED" || !child) break;
    current = child;
  }
  if (command === "stop") {
    // Remove only this collection's copies, never the Terraform-managed templates.
    for (const schedule of manifest.staticSchedules ?? []) {
      if (!schedule.name.startsWith("collection-")) throw new Error("Not a temporary collection schedule: " + schedule.name);
      try {
        aws("scheduler", "delete-schedule", "--name", schedule.name, "--group-name", schedule.groupName);
      } catch (error) {
        if (!(error instanceof Error) || !("stderr" in error) || !String(error.stderr).includes("ResourceNotFoundException")) throw error;
      }
    }
    if (execution?.status === "RUNNING") aws("stepfunctions", "stop-execution", "--execution-arn", current);
    for (const initial of manifest.initialStaticExecutions ?? []) {
      const snapshot = aws("stepfunctions", "describe-execution", "--execution-arn", initial.executionArn);
      if (snapshot.status === "RUNNING") aws("stepfunctions", "stop-execution", "--execution-arn", initial.executionArn);
    }
    console.log(JSON.stringify({ stoppedExecutionArn: current, deletedStaticSchedules: manifest.staticSchedules ?? [] }));
    process.exit(0);
  }
  if (!current) {
    console.log(JSON.stringify({ realtimeStarted: false, initialStaticExecutions: manifest.initialStaticExecutions ?? [] }, null, 2));
    process.exit(0);
  }
  for (const feedKey of manifest.feedKeys as RealtimeFeedKey[]) {
    const prefix = realtimeFeeds[feedKey].objectPrefix;
    const keys = new Set<string>();
    const firstDay = new Date(manifest.startedAt);
    firstDay.setUTCHours(0, 0, 0, 0);
    for (let day = firstDay.getTime(); day <= endMs; day += 86_400_000) {
      const date = new Date(day).toISOString().slice(0, 10).replaceAll("-", "/");
      const result = aws("s3api", "list-objects-v2", "--bucket", manifest.bucket,
        "--prefix", prefix + "/" + date + "/", "--query", "Contents[].Key");
      for (const key of result ?? []) keys.add(key);
    }
    const samples = [...keys].filter((key) => key.endsWith(".pb")).map((key) => {
      const stamp = key.slice(-19, -3);
      const time = Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
      return { key, time };
    }).filter(({ time }) => time >= Date.parse(manifest.startedAt) && time <= endMs)
      .sort((a, b) => a.time - b.time);
    const gaps = samples.flatMap((sample, index) => index > 0 && sample.time - samples[index - 1].time > 120_000
      ? [{ after: new Date(samples[index - 1].time).toISOString(), seconds: (sample.time - samples[index - 1].time) / 1000 }]
      : []);
    report.push({
      feedKey, chain, activeExecutionArn: current, status: execution.status,
      samples: samples.length,
      missingMetadata: samples.filter(({ key }) => !keys.has(key + ".metadata.json")).map(({ key }) => key),
      firstSampleAt: samples[0] ? new Date(samples[0].time).toISOString() : null,
      lastSampleAt: samples.at(-1) ? new Date(samples.at(-1)!.time).toISOString() : null,
      gapsOverTwoMinutes: gaps,
      error: execution.error,
    });
  }
  const alarms = aws("cloudwatch", "describe-alarms", "--alarm-name-prefix", manifest.alarmPrefix);
  const alarmHistory = [];
  for (const suffix of ["duration", "errors", "rate_limits"]) {
    const history = aws("cloudwatch", "describe-alarm-history",
      "--alarm-name", manifest.alarmPrefix + "-" + suffix,
      "--start-date", manifest.startedAt, "--end-date", new Date().toISOString(),
      "--history-item-type", "StateUpdate");
    alarmHistory.push(...history.AlarmHistoryItems);
  }
  console.log(JSON.stringify({ stopAt: manifest.stopAt, staticSchedules: manifest.staticSchedules ?? [], report, alarms: alarms.MetricAlarms, alarmHistory }, null, 2));
} else {
  throw new Error("Usage: pnpm collection <validate|test-notifications|notifications|smoke FEED_KEYS...|start FEED_KEYS...|status MANIFEST|stop MANIFEST>");
}

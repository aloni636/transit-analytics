import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { realtimeFeeds, type RealtimeFeedKey } from "@transit-analytics/shared/feeds";

const [command, manifestPath] = process.argv.slice(2);
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
    const startedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const stopAt = new Date(Date.parse(startedAt) + (command === "smoke" ? 120 : 172800) * 1000).toISOString();
    const feeds = Object.keys(realtimeFeeds).filter((key) =>
      key.startsWith("GTFS_SWEDEN_3_TRIP_UPDATES_") || key === "GTFS_SWITZERLAND_TRIP_UPDATES",
    ) as RealtimeFeedKey[];
    const manifest = {
      region, startedAt, stopAt, pollingSeconds: 60,
      bucket: outputs.data_lake_bucket.value as string,
      alarmPrefix: outputs.realtime_fetcher_function_name.value as string,
      stateMachineArn: outputs.realtime_feed_workflow_arn.value as string,
      executions: [] as { feedKey: RealtimeFeedKey; executionArn: string }[],
    };
    await mkdir(".collections", { recursive: true });
    const path = ".collections/" + command + "-" + startedAt.replaceAll(":", "-") + ".json";
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    console.log("Collection manifest: " + path);
    for (const feedKey of feeds) {
      const result = aws("stepfunctions", "start-execution",
        "--state-machine-arn", manifest.stateMachineArn,
        "--name", feedKey + "-" + startedAt.replaceAll(/[^0-9A-Za-z_-]/g, "-"),
        "--input", JSON.stringify({ feedKey, pollingSeconds: 60, stopAt }));
      manifest.executions.push({ feedKey, executionArn: result.executionArn });
      await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
      console.log(JSON.stringify({ feedKey, executionArn: result.executionArn, stopAt }));
    }
  }
} else if (command === "status" && manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (region !== manifest.region) throw new Error("Set AWS_REGION to " + manifest.region);
  const report: Record<string, unknown>[] = [];
  const endMs = Math.min(Date.now(), Date.parse(manifest.stopAt));
  for (const initial of manifest.executions) {
    let current = initial.executionArn;
    let execution: any;
    const chain: string[] = [];
    while (true) {
      chain.push(current);
      execution = aws("stepfunctions", "describe-execution", "--execution-arn", current);
      const output = execution.output ? JSON.parse(execution.output) : {};
      const child = output.ExecutionArn ?? output.executionArn;
      if (execution.status !== "SUCCEEDED" || !child) break;
      current = child;
    }
    const prefix = realtimeFeeds[initial.feedKey as RealtimeFeedKey].objectPrefix;
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
      feedKey: initial.feedKey, chain, activeExecutionArn: current, status: execution.status,
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
  console.log(JSON.stringify({ stopAt: manifest.stopAt, report, alarms: alarms.MetricAlarms, alarmHistory }, null, 2));
} else {
  throw new Error("Usage: pnpm collection <validate|test-notifications|notifications|smoke|start|status MANIFEST>");
}

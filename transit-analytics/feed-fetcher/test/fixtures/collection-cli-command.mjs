#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.CLI_TEST_TRACE, JSON.stringify(args) + "\n");
const value = (flag) => args[args.indexOf(flag) + 1];
if (args[0].startsWith("-chdir=")) {
  console.log(JSON.stringify({
    data_lake_bucket: { value: "test-bucket" },
    realtime_fetcher_function_name: { value: "test-realtime" },
    realtime_feed_workflow_arn: { value: "arn:aws:states:eu-central-1:123456789012:stateMachine:realtime" },
    static_feed_workflow_arn: { value: "arn:aws:states:eu-central-1:123456789012:stateMachine:static" },
    static_feed_schedules: { value: {
      GTFS_SWEDEN_3: { name: "original-sweden", groupName: "default" },
      GTFS_SWITZERLAND: { name: "original-swiss", groupName: "default" },
    } },
  }));
} else if (args[0] === "scheduler" && args[1] === "get-schedule") {
  assert.match(value("--name"), /^original-(sweden|swiss)$/);
  const sweden = value("--name") === "original-sweden";
  console.log(JSON.stringify({
    ScheduleExpression: sweden ? "cron(0 7 * * ? *)" : "cron(0 16 ? * MON,THU *)",
    ScheduleExpressionTimezone: sweden ? "Europe/Stockholm" : "Europe/Zurich",
    FlexibleTimeWindow: { Mode: "OFF" }, State: "DISABLED",
    Target: { Arn: "test-executor", RoleArn: "test-scheduler-role", Input: JSON.stringify({
      feedKeys: [sweden ? "GTFS_SWEDEN_3" : "GTFS_SWITZERLAND"],
      scheduledTime: "<aws.scheduler.scheduled-time>",
      scheduleArn: "<aws.scheduler.schedule-arn>", stateMachineArn: "static-workflow",
    }) },
  }));
} else if (args[0] === "scheduler" && args[1] === "create-schedule") {
  const schedule = JSON.parse(value("--cli-input-json"));
  assert.match(schedule.Name, /^collection-/);
  if (process.env.FAIL_SECOND_CREATE && readFileSync(process.env.CLI_TEST_TRACE, "utf8").split('\n').filter((line) => line.includes('"create-schedule"')).length === 2) {
    throw new Error("Forced schedule creation failure");
  }
  console.log(JSON.stringify({ ScheduleArn: "arn:test:schedule/" + schedule.Name }));
} else if (args[0] === "scheduler" && args[1] === "delete-schedule") {
  assert.match(value("--name"), /^collection-/);
  if (process.env.SCHEDULES_GONE) throw new Error("ResourceNotFoundException");
  console.log("{}");
} else if (args[0] === "stepfunctions" && args[1] === "start-execution") {
  const input = JSON.parse(value("--input"));
  if (value("--state-machine-arn").endsWith(":static")) {
    assert.deepEqual(Object.keys(input), ["feedKeys", "scheduledTime"]);
    assert.equal(input.feedKeys.length, 1);
    assert(Number.isFinite(Date.parse(input.scheduledTime)));
    console.log(JSON.stringify({ executionArn: "arn:test:execution:initial-" + input.feedKeys[0] }));
  } else {
    assert.equal(value("--state-machine-arn"), "arn:aws:states:eu-central-1:123456789012:stateMachine:realtime");
    assert.equal(input.pollingSeconds, 60);
    assert(Number.isFinite(Date.parse(input.stopAt)));
    console.log(JSON.stringify({ executionArn: "arn:test:execution:parent" }));
  }
} else if (args[0] === "stepfunctions" && args[1] === "describe-execution") {
  console.log(JSON.stringify(value("--execution-arn").includes(":initial-")
    ? { status: process.env.FAIL_INITIAL_STATIC ? "FAILED" : "SUCCEEDED" }
    : value("--execution-arn").endsWith("parent")
    ? { status: "SUCCEEDED", output: JSON.stringify({ ExecutionArn: "arn:test:execution:child" }) }
    : { status: "RUNNING" }));
} else if (args[0] === "stepfunctions" && args[1] === "stop-execution") {
  assert.equal(value("--execution-arn"), "arn:test:execution:child");
  console.log("{}");
} else throw new Error("Unexpected AWS operation: " + args.join(" "));

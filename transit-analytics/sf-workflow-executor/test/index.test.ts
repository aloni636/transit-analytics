import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionName, createWorkflowInput } from "../index.js";

test("creates a deterministic Step Functions execution name", () => {
  const first = createExecutionName(
    ["GTFS_SWITZERLAND"],
    "2026-08-09T12:00:00Z",
  );
  const second = createExecutionName(
    ["GTFS_SWITZERLAND"],
    "2026-08-09T12:00:00Z",
  );

  // This block verifies that retries reuse one valid name while another scheduled occurrence gets a different name.
  assert.equal(first, "GTFS_SWITZERLAND-2026-08-09T12-00-00Z");
  assert.equal(second, first);
  // Step Functions names need this restricted character set for CloudWatch Logs support.
  assert.match(first, /^[0-9A-Za-z_-]+$/);
  assert.notEqual(
    first,
    createExecutionName(["GTFS_SWITZERLAND"], "2026-08-11T12:00:00Z"),
  );
});

test("forwards only the scheduled feed and sample time", async () => {
  const input = JSON.parse(
    createWorkflowInput({
      stateMachineArn: "arn:aws:states:::stateMachine:static",
      scheduleArn: "arn:aws:scheduler:::schedule/realtime",
      feedKeys: ["GTFS_SWITZERLAND"],
      scheduledTime: "2026-08-09T12:00:00Z",
    }),
  ) as Record<string, unknown>;
  assert.deepEqual(input, {
    feedKeys: ["GTFS_SWITZERLAND"],
    scheduledTime: "2026-08-09T12:00:00Z",
  });
});

test("batch execution names remain bounded and distinguish feeds and scheduled occurrences", () => {
  const keys = ["GTFS_SWITZERLAND", "GTFS_GERMANY"] as const;
  const timestamp = "2026-08-09T12:00:00Z";
  const name = createExecutionName([...keys], timestamp);
  assert.equal(name, createExecutionName([...keys], timestamp));
  assert(name.length <= 80);
  assert.match(name, /^[0-9A-Za-z_-]+$/);
  assert.notEqual(name, createExecutionName([...keys], "2026-08-10T12:00:00Z"));
  assert.notEqual(name, createExecutionName(["GTFS_SWITZERLAND", "GTFS_SWEDEN_3"], timestamp));
});

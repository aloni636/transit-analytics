import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionName } from "../index.js";

test("creates a deterministic Step Functions execution name", () => {
  const first = createExecutionName(
    "GTFS_SWITZERLAND",
    "2026-08-09T12:00:00Z",
  );
  const second = createExecutionName(
    "GTFS_SWITZERLAND",
    "2026-08-09T12:00:00Z",
  );

  // This block verifies that retries reuse one valid name while another scheduled occurrence gets a different name.
  assert.equal(first, "GTFS_SWITZERLAND-2026-08-09T12-00-00Z");
  assert.equal(second, first);
  // Step Functions names need this restricted character set for CloudWatch Logs support.
  assert.match(first, /^[0-9A-Za-z_-]+$/);
  assert.notEqual(
    first,
    createExecutionName("GTFS_SWITZERLAND", "2026-08-11T12:00:00Z"),
  );
});

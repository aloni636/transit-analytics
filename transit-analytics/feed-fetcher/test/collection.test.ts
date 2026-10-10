import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const keys = ["GTFS_SWEDEN_3_TRIP_UPDATES_SL", "GTFS_SWEDEN_3_TRIP_UPDATES_UL", "GTFS_SWITZERLAND_TRIP_UPDATES"];

test("copies unique static schedules for the collection window and cleans up partial launches", async () => {
  for (const mode of ["start", "smoke", "partial"]) {
    const directory = await mkdtemp(join(tmpdir(), "collection-cli-test-"));
    try {
      const fixture = fileURLToPath(new URL("fixtures/collection-cli-command.mjs", import.meta.url));
      for (const command of ["aws", "terraform"]) await symlink(fixture, join(directory, command));
      await symlink(join(cwd, "node_modules"), join(directory, "node_modules"));
      const tracePath = join(directory, "calls.jsonl");
      const env = { ...process.env, PATH: directory + delimiter + process.env.PATH, CLI_TEST_TRACE: tracePath,
        ...(mode === "partial" ? { FAIL_SECOND_CREATE: "1" } : {}),
      };
      const result = spawnSync(process.execPath, ["--import", "tsx", join(cwd, "scripts/collection.ts"), mode === "smoke" ? "smoke" : "start", ...keys], {
        cwd: directory, encoding: "utf8", env,
      });
      assert.equal(result.status, mode === "partial" ? 1 : 0, result.stderr);
      if (mode === "partial") assert.match(result.stderr, /Partial collection launch/);
      const path = result.stdout.split("\n")[0].replace("Collection manifest: ", "");
      const manifest = JSON.parse(await readFile(join(directory, path), "utf8"));
      const calls = (await readFile(tracePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
      assert.equal(Date.parse(manifest.stopAt) - Date.parse(manifest.startedAt), (mode === "smoke" ? 120 : 172800) * 1000);
      assert.deepEqual(manifest.staticSchedules.map((schedule: any) => schedule.feedKey), ["GTFS_SWEDEN_3", "GTFS_SWITZERLAND"]);
      assert(manifest.executionArn);
      assert.equal(manifest.staticSchedules.filter((schedule: any) => schedule.arn).length, mode === "partial" ? 1 : 2);
      assert.equal(calls.filter((call) => call[1] === "get-schedule").length, 2);
      assert.equal(calls.filter((call) => call[1] === "start-execution").length, 1);
      const copies = calls.filter((call) => call[1] === "create-schedule").map((call) => JSON.parse(call[call.indexOf("--cli-input-json") + 1]));
      assert.equal(copies.length, 2);
      for (const [index, copy] of copies.entries()) {
        assert(copy.Name.length <= 64);
        assert.equal(copy.StartDate, manifest.startedAt);
        assert.equal(copy.EndDate, manifest.stopAt);
        assert.equal(copy.ActionAfterCompletion, "DELETE");
        assert.equal(copy.State, "ENABLED");
        assert.equal(copy.ScheduleExpression, index === 0 ? "cron(0 7 * * ? *)" : "cron(0 16 ? * MON,THU *)");
        assert.equal(copy.ScheduleExpressionTimezone, index === 0 ? "Europe/Stockholm" : "Europe/Zurich");
        assert.deepEqual(copy.FlexibleTimeWindow, { Mode: "OFF" });
        assert.equal(copy.Target.RoleArn, "test-scheduler-role");
        const input = JSON.parse(copy.Target.Input);
        assert.equal(input.stopAt, manifest.stopAt);
        assert.equal(input.scheduledTime, "<aws.scheduler.scheduled-time>");
        assert.deepEqual(input.feedKeys, [manifest.staticSchedules[index].feedKey]);
        assert.deepEqual(copy.Target.RetryPolicy, { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 });
      }
      const stopped = spawnSync(process.execPath, ["--import", "tsx", join(cwd, "scripts/collection.ts"), "stop", path], {
        cwd: directory, encoding: "utf8", env: { ...env, SCHEDULES_GONE: mode === "smoke" ? "1" : "" },
      });
      assert.equal(stopped.status, 0, stopped.stderr);
      const cleanup = (await readFile(tracePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
      assert.equal(cleanup.filter((call) => call[1] === "delete-schedule").length, 2);
      assert.equal(cleanup.filter((call) => call[1] === "stop-execution").length, 1);
      assert(!cleanup.some((call) => call[1] === "update-schedule"));
    } finally {
      await rm(directory, { recursive: true });
    }
  }
});

test("rejects missing, duplicate, unknown and static keys before calling AWS", () => {
  for (const invalid of [[], [keys[0], keys[0]], ["UNKNOWN"], ["GTFS_SWITZERLAND"]]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/collection.ts", "start", ...invalid], { cwd, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Supply unique realtime feed keys/);
    assert.doesNotMatch(result.stderr, /Command failed/);
  }
});

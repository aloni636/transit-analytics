import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import jsonata from "jsonata";
import { parse } from "yaml";
import { realtimeFeeds } from "@transit-analytics/shared/feeds";

const minimums = Object.fromEntries(Object.entries(realtimeFeeds).map(
  ([key, feed]) => [key, feed.minimumPollIntervalSeconds],
));
const template = await readFile(new URL(
  "../../../infra/modules/transit-analytics/realtime-feed-workflow.asl.yaml",
  import.meta.url,
), "utf8");
const definition = parse(template
  .replace("${realtime_minimums}", JSON.stringify(minimums))
  .replace("${realtime_fetcher_arn}", "arn:aws:lambda:eu-central-1:123456789012:function:realtime"));
const start = Date.parse("2026-10-10T12:00:00Z");
const input = {
  feedKeys: ["GTFS_SWEDEN_3_TRIP_UPDATES_SL", "GTFS_SWITZERLAND_TRIP_UPDATES"],
  pollingSeconds: 60,
  stopAt: new Date(start + 172_800_000).toISOString(),
};

// Interpret the checked-in states, evaluating their actual JSONata expressions with a deterministic clock.
async function simulate(initial: Record<string, unknown>, failSamples = false) {
  let data: any = structuredClone(initial);
  let stateName = definition.StartAt;
  let now = start;
  let historyUpperBound = 2;
  let failures = 0;
  const samples: number[] = [];
  const variables: Record<string, unknown> = {};
  const expressions = new Map<string, ReturnType<typeof jsonata>>();
  const evaluate = async (source: string) => {
    let expression = expressions.get(source);
    if (!expression) {
      expression = jsonata(source.slice(2, -2).trim());
      expression.registerFunction("millis", () => now, "<:n>");
      expressions.set(source, expression);
    }
    return expression.evaluate({}, { ...variables, states: { input: data, context: { State: { EnteredTime: new Date(now).toISOString() } } } });
  };
  for (let transitions = 0; transitions < 10_000; transitions++) {
    const state = definition.States[stateName];
    historyUpperBound += state.Type === "Task" ? 7 : 2;
    if (state.Type === "Fail") return { rejected: true, samples, historyUpperBound };
    if (state.Type === "Succeed") return { complete: true, samples, now, failures, historyUpperBound };
    if (state.Type === "Choice") {
      let next = state.Default;
      for (const choice of state.Choices) {
        if (await evaluate(choice.Condition)) {
          for (const [key, value] of Object.entries(choice.Assign ?? {})) {
            variables[key] = typeof value === "string" ? await evaluate(value) : value;
          }
          next = choice.Next;
          break;
        }
      }
      stateName = next;
      continue;
    }
    if (state.Type === "Wait") {
      now = Math.max(now, Date.parse(await evaluate(state.Timestamp)));
    } else if (state.Type === "Task" && state.Resource.endsWith("lambda:invoke")) {
      assert.equal(await evaluate(state.Arguments.Payload.scheduledTime), new Date(now).toISOString());
      assert.deepEqual(await evaluate(state.Arguments.Payload.feedKeys), input.feedKeys);
      assert.deepEqual(Object.keys(state.Arguments.Payload), ["feedKeys", "scheduledTime"]);
      assert.equal(state.Retry, undefined);
      samples.push(now);
      now += 2_000;
      if (failSamples) {
        failures++;
        for (const [key, value] of Object.entries(state.Catch[0].Assign)) {
          variables[key] = await evaluate(value as string);
        }
        data = await evaluate(state.Catch[0].Output);
        stateName = state.Catch[0].Next;
        continue;
      }
      for (const [key, value] of Object.entries(state.Assign)) variables[key] = await evaluate(value as string);
      data = await evaluate(state.Output);
    } else if (state.Type === "Task" && state.Resource.endsWith("states:startExecution")) {
      assert.equal(state.End, true);
      assert.equal(state.Parameters["StateMachineArn.$"], "$$.StateMachine.Id");
      assert.equal(state.Parameters["Name.$"], "States.Hash($$.Execution.Id, 'SHA-256')");
      assert.equal(state.Parameters.Input["stopAt.$"], "$.stopAt");
      assert.equal(state.Parameters.Input["feedKeys.$"], "$.feedKeys");
      return { continued: true, samples, now, failures, historyUpperBound, iteration: variables.iteration };
    } else throw new Error("Unexpected state: " + stateName);
    stateName = state.Next;
  }
  throw new Error("Workflow failed to terminate");
}

test("rejects unknown/static feeds, invalid intervals and malformed stop times before fetching", async () => {
  for (const override of [
    { feedKeys: ["UNKNOWN"] }, { feedKeys: ["GTFS_SWITZERLAND"] },
    { feedKeys: [] }, { feedKeys: input.feedKeys[0] },
    { feedKeys: [input.feedKeys[0], input.feedKeys[0]] }, { feedKeys: [123] },
    { feedKeys: [input.feedKeys[0], "UNKNOWN"] },
    { pollingSeconds: 30 }, { pollingSeconds: 60.5 }, { pollingSeconds: "60" },
    { stopAt: "tomorrow" }, { stopAt: "2026-10-10T12:00:00" },
  ]) {
    const result = await simulate({ ...input, ...override });
    assert.equal(result.rejected, true);
    assert.equal(result.samples.length, 0);
  }
});

test("uses only three states per polling cycle and no Pass states", () => {
  assert(!Object.values(definition.States).some((state: any) => state.Type === "Pass"));
  assert.equal(definition.States.FetchRealtimeFeed.Next, "WaitForSample");
  assert.equal(definition.States.WaitForSample.Next, "CheckCollection");
  assert.equal(definition.States.CheckCollection.Default, "FetchRealtimeFeed");
});

test("stops at the deadline and caps the last wait instead of making an extra sample", async () => {
  const result = await simulate({ ...input, stopAt: new Date(start + 20_000).toISOString() });
  assert.equal(result.complete, true);
  assert.deepEqual(result.samples, [start]);
  assert.equal(result.now, start + 20_000);
  assert.equal((await simulate({ ...input, stopAt: new Date(start).toISOString() })).samples.length, 0);
});

test("counts failures and preserves the polling wait before the 1000-attempt continuation", async () => {
  for (const fail of [false, true]) {
    const result = await simulate(input, fail);
    assert.equal(result.continued, true);
    assert.equal(result.iteration, 1000);
    assert.equal(result.samples.length, 1000);
    assert.equal(result.failures, fail ? 1000 : 0);
    assert.equal(result.samples[1] - result.samples[0], 62_000);
    assert.equal(result.now, start + 1000 * 62_000);
    assert(result.historyUpperBound < 25_000);
  }
});

test("deadline takes precedence over continuation at the 1000th attempt", async () => {
  const result = await simulate({ ...input, stopAt: new Date(start + 1000 * 62_000).toISOString() });
  assert.equal(result.complete, true);
  assert.equal(result.continued, undefined);
  assert.equal(result.samples.length, 1000);
});

test("normalizes fractional deadlines to avoid a repeated wait at AWS second precision", async () => {
  const result = await simulate({ ...input, stopAt: new Date(start + 20_999).toISOString() });
  assert.equal(result.complete, true);
  assert.equal(result.now, start + 20_000);
});

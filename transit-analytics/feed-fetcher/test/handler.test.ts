import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "aws-lambda";
import { UpstreamResponseError } from "../fetcher.js";
import { S3Client } from "@aws-sdk/client-s3";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { assertFetcherEvent } from "@transit-analytics/shared/feeds";

process.env.DESTINATION_BUCKET = "handler-test";
process.env.GTFS_USER_AGENT = "transit-analytics/test";
const { handler } = await import("../handler.js");
const event = {
  feedKeys: ["GTFS_GERMANY_REALTIME" as const],
  scheduledTime: "2026-10-10T12:00:00Z",
};

test("uses remaining Lambda time to cancel before its deadline", async (t) => {
  let captured: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_request: Request, options: RequestInit) => {
    captured = options.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      captured!.addEventListener("abort", () => reject(captured!.reason), { once: true });
    });
  });
  const context = {
    awsRequestId: "deadline-test",
    getRemainingTimeInMillis: () => 1_050,
  } as Context;
  // Keep the test process alive while the handler's deliberately unreferenced deadline timer runs.
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await assert.rejects(
      async () => handler(event, context, () => {}),
      /Lambda execution deadline approaching/,
    );
    assert.equal(captured?.aborted, true);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("logs structured rate limits and rethrows the provider failure", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("rate limit", { status: 429, headers: { "retry-after": "60" } }),
  );
  const errors = t.mock.method(console, "error", () => {});
  const context = {
    awsRequestId: "rate-limit-test",
    getRemainingTimeInMillis: () => 25_000,
  } as Context;
  await assert.rejects(
    async () => handler(event, context, () => {}),
    (error: unknown) => error instanceof UpstreamResponseError && error.rateLimited,
  );
  const structured = errors.mock.calls.map((call) => call.arguments[0]);
  assert.deepEqual(structured.find((entry) => entry.event === "fetch.rate_limited"), {
    event: "fetch.rate_limited",
    feedKey: event.feedKeys[0],
    requestId: "rate-limit-test",
    remainingMs: 25_000,
    errorType: "UpstreamResponseError",
    status: 429,
    retryAfterMs: 60_000,
  });
});

test("recognizes a Swiss rate-limit JSON body even with HTTP 200", async (t) => {
  process.env.GTFS_SWITZERLAND_REALTIME_DATA = "test-credential";
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      headers: { "content-type": "application/json" },
    }),
  );
  const errors = t.mock.method(console, "error", () => {});
  try {
    await assert.rejects(
      async () => handler(
        { ...event, feedKeys: ["GTFS_SWITZERLAND_TRIP_UPDATES"] },
        { getRemainingTimeInMillis: () => 25_000 } as Context,
        () => {},
      ),
      (error: unknown) => error instanceof UpstreamResponseError && error.rateLimited && error.status === 200,
    );
    assert(errors.mock.calls.some((call) => call.arguments[0].event === "fetch.rate_limited"));
  } finally {
    delete process.env.GTFS_SWITZERLAND_REALTIME_DATA;
  }
});

test("accepts only nonempty unique arrays of registered feed keys", () => {
  assert.doesNotThrow(() => assertFetcherEvent(event));
  for (const invalid of [
    { feedKey: event.feedKeys[0] }, { feedKeys: [] }, { feedKeys: "GTFS_GERMANY_REALTIME" },
    { feedKeys: ["UNKNOWN"] }, { feedKeys: ["INTEGRATION_TEST_REALTIME"] },
    { feedKeys: [event.feedKeys[0], event.feedKeys[0]] }, { feedKeys: [123] },
    { feedKeys: event.feedKeys, feedKey: event.feedKeys[0] },
  ]) assert.throws(() => assertFetcherEvent({ scheduledTime: event.scheduledTime, ...invalid }));
  assert.throws(() => assertFetcherEvent({ ...event, scheduledTime: "tomorrow" }));
});

test("fetches feeds concurrently and retains successful uploads when another feed fails", async (t) => {
  process.env.GTFS_SWITZERLAND_REALTIME_DATA = "test-credential";
  const bytes = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0" }, entity: [],
  }).finish();
  const uploaded: string[] = [];
  t.mock.method(S3Client.prototype, "send", async (command: any) => {
    uploaded.push(command.input.Key);
    return { ETag: '"test"', $metadata: { httpStatusCode: 200 } };
  });
  const context = { getRemainingTimeInMillis: () => 25_000 } as Context;
  try {
    for (const failGermany of [false, true]) {
      uploaded.length = 0;
      const pending: (() => void)[] = [];
      t.mock.method(globalThis, "fetch", async (request: Request) => {
        await new Promise<void>((resolve) => {
          pending.push(resolve);
          if (pending.length === 2) pending.forEach((release) => release());
        });
        const response = failGermany && request.url.includes("gtfs.de")
          ? new Response("Rate limit", { status: 429 })
          : new Response(bytes);
        Object.defineProperty(response, "url", { value: request.url });
        return response;
      });
      const invocation = handler({
        ...event, feedKeys: ["GTFS_GERMANY_REALTIME", "GTFS_SWITZERLAND_TRIP_UPDATES"],
      }, context, () => {});
      if (failGermany) {
        await assert.rejects(async () => invocation, (error: unknown) => error instanceof UpstreamResponseError && error.rateLimited);
      } else {
        const result = await invocation;
        assert.equal(result?.length, 2);
      }
      assert.equal(pending.length, 2);
      assert.equal(uploaded.filter((key) => key.endsWith(".pb")).length, failGermany ? 1 : 2);
      assert.equal(uploaded.filter((key) => key.endsWith(".metadata.json")).length, failGermany ? 1 : 2);
    }
  } finally {
    delete process.env.GTFS_SWITZERLAND_REALTIME_DATA;
  }
});

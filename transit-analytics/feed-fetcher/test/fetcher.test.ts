import { S3Client } from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  createFeedRequest,
  realtimeFeeds,
  staticFeeds,
  validateRealtimeInterval,
} from "@transit-analytics/shared/feeds";
import {
  fetchStaticFeed,
  isSwissRateLimitBody,
  parseRetryAfterMs,
  UpstreamResponseError,
} from "../fetcher.js";


test("builds authenticated realtime requests declaratively", () => {
  const swiss = createFeedRequest(
    realtimeFeeds.GTFS_SWITZERLAND_TRIP_UPDATES,
    "transit-analytics/test",
    "swiss-secret",
  );
  assert.equal(swiss.headers.get("user-agent"), "transit-analytics/test");
  assert.equal(
    swiss.headers.get("accept-encoding"),
    "br, gzip, deflate",
  );
  assert.equal(swiss.headers.get("authorization"), "Bearer swiss-secret");

  const sweden = createFeedRequest(
    realtimeFeeds.GTFS_SWEDEN_3_TRIP_UPDATES_SL,
    "transit-analytics/test",
    "sweden-secret",
  );
  assert.equal(new URL(sweden.url).searchParams.get("key"), "sweden-secret");
});

test("keeps existing static feeds and all referenced realtime definitions", () => {
  assert.equal(staticFeeds.GTFS_SVERIGE_2.objectPrefix, "raw/sweden/gtfs-static/gtfs-sverige-2");
  assert.equal(Object.keys(realtimeFeeds).length, 25);
  assert.equal(realtimeFeeds.GTFS_SWITZERLAND_TRIP_UPDATES.minimumPollIntervalSeconds, 31);
});

test("enforces each realtime feed's minimum interval", () => {
  assert.doesNotThrow(() =>
    validateRealtimeInterval("GTFS_SWITZERLAND_TRIP_UPDATES", 31),
  );
  assert.throws(
    () => validateRealtimeInterval("GTFS_SWITZERLAND_TRIP_UPDATES", 30),
    /must be at least 31/,
  );
});

test("recognizes Swiss rate limits and Retry-After values", () => {
  assert.equal(isSwissRateLimitBody('{"error":"Rate limit exceeded"}'), true);
  assert.equal(isSwissRateLimitBody("Rate limit exceeded"), false);
  const now = Date.parse("2026-08-18T12:00:00Z");
  assert.equal(parseRetryAfterMs("12", now), 12_000);
  assert.equal(
    parseRetryAfterMs("Tue, 18 Aug 2026 12:00:30 GMT", now),
    30_000,
  );
});

test("surfaces a Swiss rate-limit response without touching S3", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Rate limit exceeded" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  process.env.INTEGRATION_TEST_REALTIME_URL =
    `http://127.0.0.1:${address.port}/rate-limit`;
  try {
    await assert.rejects(
      fetchStaticFeed(
        "INTEGRATION_TEST_REALTIME",
        new Date("2026-08-09T12:00:00Z"),
        new S3Client({}),
        "unused-bucket",
      ),
      (error: unknown) =>
        error instanceof UpstreamResponseError &&
        error.status === 429 &&
        error.rateLimited,
    );
  } finally {
    delete process.env.INTEGRATION_TEST_REALTIME_URL;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("rejects an invalid realtime protobuf", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(Buffer.from([0xff, 0xff, 0xff]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  process.env.INTEGRATION_TEST_REALTIME_URL =
    `http://127.0.0.1:${address.port}/invalid`;
  try {
    await assert.rejects(
      fetchStaticFeed(
        "INTEGRATION_TEST_REALTIME",
        new Date("2026-08-09T12:00:00Z"),
        new S3Client({}),
        "unused-bucket",
      ),
    );
  } finally {
    delete process.env.INTEGRATION_TEST_REALTIME_URL;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

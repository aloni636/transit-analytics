import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { fetchStaticFeed } from "../fetcher.js";

async function readText(body: { transformToString(): Promise<string> }): Promise<string> {
  return body.transformToString();
}

test("fetches, validates, and stores a realtime protobuf with metadata", async () => {
  const bucket = `realtime-fetcher-test-${Date.now()}`;
  const scheduledTime = new Date("2026-08-09T12:00:00Z");
  const bytes = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
    header: {
      gtfsRealtimeVersion: "2.0",
      timestamp: 1_755_000_000,
      feedVersion: "fixture-version",
    },
    entity: [],
  }).finish();
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://rustfs:9000",
    region: process.env.AWS_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "rustfsadmin",
      secretAccessKey: "rustfsadmin",
    },
  });
  let objectKeys: string[] = [];
  let bucketCreated = false;
  let receivedUserAgent: string | undefined;
  let receivedAcceptEncoding: string | undefined;
  const provider = createServer((request, response) => {
    if (request.url === "/start?key=fixture-secret") {
      response.writeHead(302, { location: "/feed.pb?key=fixture-secret" });
      response.end();
      return;
    }
    receivedUserAgent = request.headers["user-agent"];
    receivedAcceptEncoding = request.headers["accept-encoding"];
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      etag: "\"protobuf-etag\"",
      "last-modified": "Sun, 09 Aug 2026 12:00:00 GMT",
    });
    response.end(bytes);
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));

  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    const address = provider.address();
    assert(address && typeof address === "object");
    process.env.INTEGRATION_TEST_REALTIME_URL =
      `http://127.0.0.1:${address.port}/start?key=fixture-secret`;

    const result = await fetchStaticFeed(
      "INTEGRATION_TEST_REALTIME",
      scheduledTime,
      s3,
      bucket,
    );
    assert.equal(
      result.key,
      "raw/integration/gtfs-realtime/mock-feed/2026/08/09/20260809T120000Z.pb",
    );
    assert.equal(receivedUserAgent, "transit-analytics/test");
    assert.equal(receivedAcceptEncoding, "br, gzip, deflate");

    const stored = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: result.key }),
    );
    assert(stored.Body);
    assert.deepEqual(
      Buffer.from(await stored.Body.transformToByteArray()),
      Buffer.from(bytes),
    );

    const metadata = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: result.metadataKey }),
    );
    assert(metadata.Body);
    const value = JSON.parse(await readText(metadata.Body)) as {
      response: { url: string; etag?: string; lastModified?: string };
      feedTimestamp?: string;
      feedVersion?: string;
    };
    assert.match(value.response.url, /key=%5BREDACTED%5D/);
    assert(!value.response.url.includes("fixture-secret"));
    assert.equal(value.response.etag, "\"protobuf-etag\"");
    assert.equal(value.response.lastModified, "Sun, 09 Aug 2026 12:00:00 GMT");
    assert.equal(value.feedTimestamp, "1755000000");
    assert.equal(value.feedVersion, "fixture-version");

    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    objectKeys = objects.Contents?.flatMap(({ Key }) => (Key ? [Key] : [])) ?? [];
    assert.deepEqual(objectKeys.sort(), [result.key, result.metadataKey].sort());
  } finally {
    if (bucketCreated) {
      const objects = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket }),
      ).catch(() => undefined);
      objectKeys = objects?.Contents?.flatMap(({ Key }) => (Key ? [Key] : [])) ?? objectKeys;
    }
    if (objectKeys.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objectKeys.map((Key) => ({ Key })) },
      }));
    }
    if (bucketCreated) {
      await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
    }
    delete process.env.INTEGRATION_TEST_REALTIME_URL;
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
    s3.destroy();
  }
});

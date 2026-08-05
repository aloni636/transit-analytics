import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Feed } from "../feeds.js";
import { fetchStaticFeed } from "../fetcher.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/GTFS Sverige 2/sweden.zip", import.meta.url),
);

async function digest(body: AsyncIterable<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of body) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function loadFixture() {
  if (!existsSync(fixturePath)) {
    throw new Error(`Missing committed GTFS fixture: ${fixturePath}`);
  }
  return {
    size: (await stat(fixturePath)).size,
    digest: await digest(createReadStream(fixturePath)),
  };
}

test("fetches and extracts a GTFS provider stream into RustFS", async () => {
  const fixture = await loadFixture();
  const bucket = `static-fetcher-test-${Date.now()}`;

  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://rustfs:9000",
    region: process.env.AWS_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "rustfsadmin",
      secretAccessKey: "rustfsadmin",
    },
  });

  let providerRequest:
    | { readonly method: string; readonly url: string | undefined }
    | undefined;
  const provider = createServer((request, response) => {
    providerRequest = { method: request.method ?? "", url: request.url };
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": fixture.size,
    });
    void pipeline(createReadStream(fixturePath), response).catch(
      (error: unknown) => {
        response.destroy(error instanceof Error ? error : undefined);
      },
    );
  });

  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  let objectKeys: string[] = [];
  let bucketCreated = false;

  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    const address = provider.address();
    assert(address && typeof address === "object");
    const mockFeed = {
      objectPrefix: "raw/integration/gtfs-static/mock-feed",
      createRequest: () =>
        new Request(
          `http://127.0.0.1:${address.port}/gtfs-static.zip`,
        ),
    } as const satisfies Feed;

    const result = await fetchStaticFeed(
      {
        key: "INTEGRATION_TEST",
        objectPrefix: mockFeed.objectPrefix,
        request: mockFeed.createRequest(),
      },
      s3,
      bucket,
    );
    assert.deepEqual(providerRequest, {
      method: "GET",
      url: "/gtfs-static.zip",
    });
    assert.match(
      result.key,
      new RegExp(`^${mockFeed.objectPrefix}/.*\\.zip$`),
    );

    const stored = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: result.key }),
    );
    assert(stored.Body);
    assert.equal(stored.ContentType, "application/zip");
    assert.equal(stored.ContentLength, fixture.size);
    assert.equal(
      await digest(stored.Body as AsyncIterable<Uint8Array>),
      fixture.digest,
    );

    const objects = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket }),
    );
    objectKeys = objects.Contents?.flatMap(({ Key }) => (Key ? [Key] : [])) ?? [];
    const extractedPrefix = result.key.slice(0, -".zip".length);
    assert.equal(objectKeys.length, 10);
    assert(objectKeys.includes(result.key));
    assert(objectKeys.includes(`${extractedPrefix}/feed_info.txt`));

    const extracted = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `${extractedPrefix}/feed_info.txt`,
      }),
    );
    assert.equal(extracted.ContentType, "application/octet-stream");
    assert.equal(extracted.ContentLength, 138);
  } finally {
    if (bucketCreated) {
      const objects = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket }),
      ).catch(() => undefined);
      objectKeys = objects?.Contents?.flatMap(({ Key }) => (Key ? [Key] : [])) ?? objectKeys;
    }
    if (objectKeys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objectKeys.map((Key) => ({ Key })) },
        }),
      );
    }
    if (bucketCreated) {
      await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => { });
    }
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
    s3.destroy();
  }
});

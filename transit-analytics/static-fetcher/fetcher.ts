import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getLocalEnvCredential, getSecretsManagerCredential } from "@transit-analytics/shared/credentials";
import {
  createFeedRequest,
  realtimeFeeds,
  staticFeeds,
  type CredentialKey,
  type FeedKey,
  type StaticFeedDefinition,
} from "@transit-analytics/shared/feeds";
import { Open } from "unzipper";

const uploadPartSize = 5 * 1024 * 1024;
const uploadConcurrency = 2;
const metadataSchemaVersion = 1;

type TestFeedKey = "INTEGRATION_TEST_STATIC" | "INTEGRATION_TEST_REALTIME";
type FetchFeedKey = FeedKey | TestFeedKey;

type ResolvedStaticFeed = {
  readonly kind: "static";
  readonly objectPrefix: string;
  readonly request: Request;
};

type ResolvedRealtimeFeed = {
  readonly kind: "realtime";
  readonly objectPrefix: string;
  readonly request: Request;
};

type ResolvedFeed = ResolvedStaticFeed | ResolvedRealtimeFeed;

export class UpstreamResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimited: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "UpstreamResponseError";
  }
}

export function parseRetryAfterMs(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized) * 1_000;
  }
  const dateMs = Date.parse(normalized);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined;
}

export function isSwissRateLimitBody(body: string): boolean {
  try {
    const value: unknown = JSON.parse(body);
    return (
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      value.error === "Rate limit exceeded"
    );
  } catch {
    return false;
  }
}

function buildObjectKey(
  prefix: string,
  scheduledTime: Date,
  suffix?: "zip" | "pb",
): string {
  const year = scheduledTime.getUTCFullYear().toString().padStart(4, "0");
  const month = (scheduledTime.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = scheduledTime.getUTCDate().toString().padStart(2, "0");
  const timestamp = scheduledTime
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${prefix}/${year}/${month}/${day}/${timestamp}${suffix ? `.${suffix}` : ""}`;
}

function metadataObjectKey(objectKey: string): string {
  return `${objectKey}.metadata.json`;
}

function entryObjectKey(prefix: string, entryPath: string): string {
  const normalizedPath = posix.normalize(entryPath);
  if (
    posix.isAbsolute(entryPath) ||
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("\0")
  ) {
    throw new Error(`Unsafe path in upstream ZIP: ${entryPath}`);
  }
  return `${prefix}/${normalizedPath}`;
}

function requiredUserAgent(feedKey: FetchFeedKey): string {
  const userAgent = process.env.GTFS_USER_AGENT?.trim();
  if (userAgent) {
    return userAgent;
  }
  if (feedKey.startsWith("INTEGRATION_TEST_")) {
    return "transit-analytics/test";
  }
  throw new Error("Missing environment variable: GTFS_USER_AGENT");
}

function sanitizeUrl(value: string): string {
  const url = new URL(value);
  for (const key of ["key", "api_key", "token", "access_token"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.set(key, "[REDACTED]");
    }
  }
  return url.toString();
}

function responseHeaders(response: Response): Record<string, string> {
  const names = [
    "age",
    "cache-control",
    "content-encoding",
    "content-length",
    "content-type",
    "date",
    "etag",
    "expires",
    "last-modified",
    "location",
    "server",
    "vary",
  ];
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = response.headers.get(name);
      if (value === null) {
        return [];
      }
      return [
        [
          name,
          name === "location" && value.startsWith("http")
            ? sanitizeUrl(value)
            : value,
        ],
      ];
    }),
  );
}

export type FetchMetadata = {
  readonly schemaVersion: typeof metadataSchemaVersion;
  readonly feedKey: FetchFeedKey;
  readonly scheduledTime: string;
  readonly fetchedAt: string;
  readonly durationMs: number;
  readonly response: {
    readonly status: number;
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly etag?: string;
    readonly lastModified?: string;
  };
  readonly byteLength?: number;
  readonly feedTimestamp?: string;
  readonly feedVersion?: string;
};

function createS3Upload(
  s3: S3Client,
  bucket: string,
  body: Readable | Uint8Array,
  key: string,
  contentType?: string,
  signal?: AbortSignal,
): Upload {
  signal?.throwIfAborted();
  const abortController = new AbortController();
  // A dependent signal avoids retaining listeners between sequential ZIP-entry uploads.
  return new Upload({
    abortController: {
      signal: signal ? AbortSignal.any([signal, abortController.signal]) : abortController.signal,
      abort: () => abortController.abort(),
    },
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
    partSize: uploadPartSize,
    queueSize: uploadConcurrency,
    // we use S3 lifecycle rules to clanup objects after AbortIncompleteMultipartUpload action
    // AbortIncompleteMultipartUpload action raises and will be logged as an error
    leavePartsOnError: false,
  });
}

async function uploadMetadata(
  s3: S3Client,
  bucket: string,
  objectKey: string,
  metadata: FetchMetadata,
  signal?: AbortSignal,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: metadataObjectKey(objectKey),
      Body: Buffer.from(JSON.stringify(metadata, null, 2) + "\n", "utf8"),
      ContentType: "application/json",
    }),
    { abortSignal: signal },
  );
}

async function fetchRealtime(
  feedKey: FetchFeedKey,
  feed: ResolvedRealtimeFeed,
  scheduledTime: Date,
  startedAt: Date,
  s3: S3Client,
  bucket: string,
  response: Response,
  signal?: AbortSignal,
): Promise<{ bucket: string; key: string; metadataKey: string }> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (feedKey.startsWith("GTFS_SWITZERLAND_") &&
      isSwissRateLimitBody(Buffer.from(bytes).toString("utf8"))) {
    throw new UpstreamResponseError(
      "Swiss provider returned a rate-limit body",
      response.status,
      true,
      parseRetryAfterMs(response.headers.get("retry-after")),
    );
  }
  const message = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const feedTimestamp = message.header.timestamp?.toString();
  const destinationKey = buildObjectKey(feed.objectPrefix, scheduledTime, "pb");
  const fetchedAt = new Date().toISOString();
  const metadata: FetchMetadata = {
    schemaVersion: metadataSchemaVersion,
    feedKey,
    scheduledTime: scheduledTime.toISOString(),
    fetchedAt,
    durationMs: Date.now() - startedAt.getTime(),
    response: {
      status: response.status,
      url: sanitizeUrl(response.url),
      headers: responseHeaders(response),
      ...(response.headers.get("etag") === null
        ? {}
        : { etag: response.headers.get("etag") ?? undefined }),
      ...(response.headers.get("last-modified") === null
        ? {}
        : { lastModified: response.headers.get("last-modified") ?? undefined }),
    },
    byteLength: bytes.byteLength,
    ...(!feedTimestamp || feedTimestamp === "0" ? {} : { feedTimestamp }),
    ...(message.header.feedVersion
      ? { feedVersion: message.header.feedVersion }
      : {}),
  };

  await createS3Upload(
    s3,
    bucket,
    bytes,
    destinationKey,
    response.headers.get("content-type") ?? "application/octet-stream",
    signal,
  ).done();
  await uploadMetadata(s3, bucket, destinationKey, metadata, signal);
  console.info({
    event: "fetch.realtime_upload.completed",
    feed: feedKey,
    destinationKey,
    metadataKey: metadataObjectKey(destinationKey),
  });
  return {
    bucket,
    key: destinationKey,
    metadataKey: metadataObjectKey(destinationKey),
  };
}

async function fetchStatic(
  feedKey: FetchFeedKey,
  feed: ResolvedStaticFeed,
  scheduledTime: Date,
  startedAt: Date,
  s3: S3Client,
  bucket: string,
  response: Response,
  signal?: AbortSignal,
): Promise<{ bucket: string; key: string; metadataKey: string }> {
  const destinationPrefix = buildObjectKey(feed.objectPrefix, scheduledTime);
  const destinationKey = buildObjectKey(feed.objectPrefix, scheduledTime, "zip");
  const temporaryArchivePath = join(
    tmpdir(),
    `static-fetcher-${process.pid}-${randomUUID()}.zip`,
  );
  const [archiveStream, temporaryArchiveStream] = response.body!.tee();
  const contentLength = response.headers.get("content-length");
  const metadata: FetchMetadata = {
    schemaVersion: metadataSchemaVersion,
    feedKey,
    scheduledTime: scheduledTime.toISOString(),
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    response: {
      status: response.status,
      url: sanitizeUrl(response.url),
      headers: responseHeaders(response),
      ...(response.headers.get("etag") === null
        ? {}
        : { etag: response.headers.get("etag") ?? undefined }),
      ...(response.headers.get("last-modified") === null
        ? {}
        : { lastModified: response.headers.get("last-modified") ?? undefined }),
    },
    ...(contentLength === null
      ? {}
      : { byteLength: Number.parseInt(contentLength, 10) }),
  };

  try {
    const uploadArchive = (async () => {
      await createS3Upload(
        s3,
        bucket,
        Readable.fromWeb(archiveStream),
        destinationKey,
        response.headers.get("content-type") ?? undefined,
        signal,
      ).done();
      console.info({
        event: "fetch.zip_upload.completed",
        feed: feedKey,
        destinationKey,
      });
    })();
    const uploadEntries = (async () => {
      // Large entries (like GTFS_SWEDEN_3's shapes.txt file) can have data-descriptor
      // byte sequences within the compressed entry forcing us to use ZIP's metastore
      // at the end of the file, meaning we have to download the ZIP file locally to use it
      await pipeline(
        Readable.fromWeb(temporaryArchiveStream),
        createWriteStream(temporaryArchivePath, { flags: "wx" }),
        { signal },
      );
      const directory = await Open.file(temporaryArchivePath);
      let entryCount = 0;

      for (const entry of directory.files) {
        if (entry.type === "Directory") {
          continue;
        }

        const key = entryObjectKey(destinationPrefix, entry.path);
        await createS3Upload(
          s3,
          bucket,
          entry.stream(),
          key,
          "application/octet-stream",
          signal,
        ).done();
        entryCount += 1;
      }
      console.info({
        event: "fetch.unzipped_upload.completed",
        feed: feedKey,
        destinationPrefix,
        entryCount,
      });
    })();

    const tasks = [uploadArchive, uploadEntries];
    try {
      await Promise.all(tasks);
    } catch (error) {
      await Promise.allSettled(tasks);
      throw error;
    }
    await uploadMetadata(s3, bucket, destinationKey, {
      ...metadata,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    }, signal);
    console.info({
      event: "fetch.completed",
      feed: feedKey,
      destinationKey,
      metadataKey: metadataObjectKey(destinationKey),
      status: response.status,
      contentLength,
      durationMs: Date.now() - startedAt.getTime(),
    });
    return {
      bucket,
      key: destinationKey,
      metadataKey: metadataObjectKey(destinationKey),
    };
  } finally {
    await rm(temporaryArchivePath, { force: true }).catch((error: unknown) => {
      console.error({
        event: "fetch.temp_cleanup_failed",
        feed: feedKey,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    });
  }
}

export async function fetchStaticFeed(
  feedKey: FetchFeedKey,
  scheduledTime: Date,
  s3: S3Client,
  bucket: string,
  signal?: AbortSignal,
) {
  const startedAt = new Date();
  let feed: ResolvedFeed;

  if (feedKey === "INTEGRATION_TEST_STATIC" || feedKey === "INTEGRATION_TEST_REALTIME") {
    const environmentVariable =
      feedKey === "INTEGRATION_TEST_STATIC"
        ? "INTEGRATION_TEST_STATIC_URL"
        : "INTEGRATION_TEST_REALTIME_URL";
    const feedUrl = process.env[environmentVariable];
    if (!feedUrl) {
      throw new Error("Missing test environment variable: " + environmentVariable);
    }
    const request = new Request(feedUrl, {
      headers: {
        "User-Agent": requiredUserAgent(feedKey),
        "Accept-Encoding": "br, gzip, deflate",
      },
    });
    feed =
      feedKey === "INTEGRATION_TEST_STATIC"
        ? {
            kind: "static",
            objectPrefix: "raw/integration/gtfs-static/mock-feed",
            request,
          }
        : {
            kind: "realtime",
            objectPrefix: "raw/integration/gtfs-realtime/mock-feed",
            request,
          };
  } else {
    const userAgent = requiredUserAgent(feedKey);
    if (Object.hasOwn(staticFeeds, feedKey)) {
      const definition = staticFeeds[
        feedKey as keyof typeof staticFeeds
      ] as StaticFeedDefinition;
      const credential = definition.authMethod
        ? process.env.AWS_LAMBDA_FUNCTION_NAME
          ? await getSecretsManagerCredential(
              definition.authMethod.secretArnEnvironmentVariable,
              definition.authMethod.credentialKey as CredentialKey,
            )
          : getLocalEnvCredential(
              definition.authMethod.credentialKey as CredentialKey,
            )
        : undefined;
      feed = {
        kind: "static",
        objectPrefix: definition.objectPrefix,
        request: createFeedRequest(definition, userAgent, credential),
      };
    } else {
      const definition =
        realtimeFeeds[feedKey as keyof typeof realtimeFeeds];
      const credential = definition.authMethod
        ? process.env.AWS_LAMBDA_FUNCTION_NAME
          ? await getSecretsManagerCredential(
              definition.authMethod.secretArnEnvironmentVariable,
              definition.authMethod.credentialKey as CredentialKey,
            )
          : getLocalEnvCredential(
              definition.authMethod.credentialKey as CredentialKey,
            )
        : undefined;
      feed = {
        kind: "realtime",
        objectPrefix: definition.objectPrefix,
        request: createFeedRequest(definition, userAgent, credential),
      };
    }
  }
  const suffix = feed.kind === "realtime" ? "pb" : "zip";
  const destinationKey = buildObjectKey(feed.objectPrefix, scheduledTime, suffix);
  console.info({ event: "fetch.started", feed: feedKey, destinationKey });

  try {
    const response = await fetch(feed.request, {
      redirect: "follow",
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.text();
      const rateLimited =
        response.status === 429 ||
        (feedKey.startsWith("GTFS_SWITZERLAND_") && isSwissRateLimitBody(body));
      throw new UpstreamResponseError(
        "Upstream fetch failed with status " + response.status,
        response.status,
        rateLimited,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }
    if (feed.kind === "realtime") {
      return await fetchRealtime(
        feedKey,
        feed,
        scheduledTime,
        startedAt,
        s3,
        bucket,
        response,
        signal,
      );
    }
    return await fetchStatic(
      feedKey,
      feed,
      scheduledTime,
      startedAt,
      s3,
      bucket,
      response,
      signal,
    );
  } catch (error) {
    console.error({
      event: "fetch.failed",
      feed: feedKey,
      destinationKey,
      errorType: error instanceof Error ? error.name : "UnknownError",
      durationMs: Date.now() - startedAt.getTime(),
    });
    throw error;
  }
}

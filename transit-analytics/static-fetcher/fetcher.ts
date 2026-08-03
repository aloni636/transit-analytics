import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const uploadPartSize = 5 * 1024 * 1024;
const uploadConcurrency = 2;

function buildObjectKey(prefix: string, date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const timestamp = date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${prefix}/${year}/${month}/${day}/${timestamp}.zip`;
}

export async function fetchStaticFeed(
  feed: {
    readonly key: string;
    readonly objectPrefix: string;
    readonly request: Request;
  },
  s3: S3Client,
  bucket: string,
) {
  const startedAt = new Date();
  const destinationKey = buildObjectKey(feed.objectPrefix, startedAt);
  console.info({ event: "fetch.started", feed: feed.key, destinationKey });

  try {
    const response = await fetch(feed.request, { redirect: "follow" });

    if (!response.ok || !response.body) {
      throw new Error(`Upstream fetch failed with status ${response.status}`);
    }

    // retry logic is defined in `S3Client({})` and defaults to "exponential backoff"
    await new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: destinationKey,
        Body: Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        ),
        ContentType: response.headers.get("content-type") ?? undefined,
      },
      partSize: uploadPartSize,
      queueSize: uploadConcurrency,
      // we use S3 lifecycle rules to clanup objects after AbortIncompleteMultipartUpload action
      // AbortIncompleteMultipartUpload action raises and will be logged as an error
      leavePartsOnError: false,
    }).done();

    console.info({
      event: "fetch.completed",
      feed: feed.key,
      destinationKey,
      status: response.status,
      contentLength: response.headers.get("content-length"),
      durationMs: Date.now() - startedAt.getTime(),
    });
    return { bucket, key: destinationKey };
  } catch (error) {
    console.error({
      event: "fetch.failed",
      feed: feed.key,
      destinationKey,
      errorType: error instanceof Error ? error.name : "UnknownError",
      durationMs: Date.now() - startedAt.getTime(),
    });
    throw error;
  }
}

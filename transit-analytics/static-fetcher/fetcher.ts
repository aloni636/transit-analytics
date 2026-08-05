import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Open } from "unzipper";

const uploadPartSize = 5 * 1024 * 1024;
const uploadConcurrency = 2;

function buildObjectKey(
  prefix: string,
  date: Date,
  suffix?: "zip",
): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const timestamp = date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${prefix}/${year}/${month}/${day}/${timestamp}${suffix ? `.${suffix}` : ""}`;
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
  const destinationPrefix = buildObjectKey(feed.objectPrefix, startedAt);
  const destinationKey = buildObjectKey(feed.objectPrefix, startedAt, "zip");
  const temporaryArchivePath = join(
    tmpdir(),
    `static-fetcher-${process.pid}-${randomUUID()}.zip`,
  );
  console.info({ event: "fetch.started", feed: feed.key, destinationKey });

  try {
    const response = await fetch(feed.request, { redirect: "follow" });

    if (!response.ok || !response.body) {
      throw new Error(`Upstream fetch failed with status ${response.status}`);
    }
    const [archiveStream, temporaryArchiveStream] = response.body.tee();

    // retry logic is defined in `S3Client({})` and defaults to "exponential backoff"
    const s3Upload = (
      body: Readable,
      key: string,
      contentType?: string,
    ) => new Upload({
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

    const uploadArchive = (async () => {
      await s3Upload(
        Readable.fromWeb(archiveStream),
        destinationKey,
        response.headers.get("content-type") ?? undefined,
      ).done();
      console.info({
        event: "fetch.zip_upload.completed",
        feed: feed.key,
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
      );
      const directory = await Open.file(temporaryArchivePath);
      let entryCount = 0;

      for (const entry of directory.files) {
        if (entry.type === "Directory") {
          continue;
        }

        const key = entryObjectKey(destinationPrefix, entry.path);
        await s3Upload(
          entry.stream(),
          key,
          "application/octet-stream",
        ).done();
        entryCount += 1;
      }
      console.info({
        event: "fetch.unzipped_upload.completed",
        feed: feed.key,
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
    } finally {
      await rm(temporaryArchivePath, { force: true }).catch((error: unknown) => {
        console.error({
          event: "fetch.temp_cleanup_failed",
          feed: feed.key,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      });
    }

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

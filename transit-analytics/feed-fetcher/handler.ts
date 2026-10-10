import { S3Client } from "@aws-sdk/client-s3";
import type { Handler } from "aws-lambda";
import {
  assertFetcherEvent,
  type FetcherEvent,
} from "@transit-analytics/shared/feeds";
import { fetchStaticFeed, UpstreamResponseError } from "./fetcher.js";

const bucket = process.env.DESTINATION_BUCKET;
if (!bucket) {
  throw new Error("Missing environment variable: DESTINATION_BUCKET");
}

// retry logic configurations: https://github.com/aws/aws-sdk-js-v3/blob/main/supplemental-docs/CLIENTS.md#retry-strategy-retrystrategy-retrymode-maxattempts
// note: "The SDK's default retry strategy is based on exponential backoff, and only retries what we consider transient errors"
// TODO: make retry policy explicit
const s3 = new S3Client({});

export const handler: Handler<
  FetcherEvent,
  Awaited<ReturnType<typeof fetchStaticFeed>>
> = async (event, context) => {
  assertFetcherEvent(event);
  const remainingMs = context.getRemainingTimeInMillis();
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Lambda execution deadline approaching"));
  const timer = setTimeout(cancel, Math.max(0, remainingMs - 1_000));
  timer.unref();
  if (remainingMs <= 1_000) cancel();
  try {
    return await fetchStaticFeed(
      event.feedKey,
      new Date(event.scheduledTime),
      s3,
      bucket,
      controller.signal,
    );
  } catch (error) {
    console.error({
      event: error instanceof UpstreamResponseError && error.rateLimited
        ? "fetch.rate_limited"
        : "fetch.invocation_failed",
      feedKey: event.feedKey,
      requestId: context.awsRequestId,
      remainingMs: context.getRemainingTimeInMillis(),
      errorType: error instanceof Error ? error.name : "UnknownError",
      ...(error instanceof UpstreamResponseError
        ? { status: error.status, retryAfterMs: error.retryAfterMs }
        : {}),
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

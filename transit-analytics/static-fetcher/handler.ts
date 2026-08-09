import { S3Client } from "@aws-sdk/client-s3";
import type { Handler } from "aws-lambda";
import { getSecretsManagerKey } from "./credentials.js";
import {
  assertStaticFetcherEvent,
  feeds,
  type StaticFetcherEvent,
} from "./feeds.js";
import { fetchStaticFeed } from "./fetcher.js";

const bucket = process.env.DESTINATION_BUCKET;
if (!bucket) {
  throw new Error("Missing environment variable: DESTINATION_BUCKET");
}

// retry logic configurations: https://github.com/aws/aws-sdk-js-v3/blob/main/supplemental-docs/CLIENTS.md#retry-strategy-retrystrategy-retrymode-maxattempts
// note: "The SDK's default retry strategy is based on exponential backoff, and only retries what we consider transient errors"
// TODO: make retry policy explicit
const s3 = new S3Client({});

export const handler: Handler<
  StaticFetcherEvent,
  Awaited<ReturnType<typeof fetchStaticFeed>>
> = async (event) => {
  assertStaticFetcherEvent(event);
  const feed = feeds[event.feedKey];
  const request =
    "credentialKey" in feed
      ? feed.createRequest(await getSecretsManagerKey(feed.credentialKey))
      : feed.createRequest();

  return fetchStaticFeed(
    {
      key: event.feedKey,
      objectPrefix: feed.objectPrefix,
      request,
    },
    new Date(event.scheduledTime),
    s3,
    bucket,
  );
};

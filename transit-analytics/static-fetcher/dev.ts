import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "dotenv";
import pRetry from "p-retry";
import { getLocalEnvKey } from "./credentials.js";
import { assertStaticFetcherEvent, feeds } from "./feeds.js";
import { fetchStaticFeed } from "./fetcher.js";

async function ensureBucket(
  client: S3Client,
  bucketName: string,
): Promise<void> {
  await pRetry(
    async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucketName }));
        return;
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: bucketName }));
      }
    },
    {
      // 20 attempts across 10 seconds to handle potential local-S3 initialization delay
      retries: 19,
      minTimeout: 500,
      maxTimeout: 500,
    },
  );
}

config({ path: ".env.development", quiet: true });

const event: unknown = { key: process.argv[2] };
assertStaticFetcherEvent(event);
const feed = feeds[event.key];
const request =
  "credentialKey" in feed
    ? feed.createRequest(getLocalEnvKey(feed.credentialKey))
    : feed.createRequest();

const bucket = process.env.DESTINATION_BUCKET ?? "transit-analytics-dev";
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://rustfs:9000",
  region: process.env.AWS_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "rustfsadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "rustfsadmin",
  },
});

await ensureBucket(s3, bucket);

const result = await fetchStaticFeed(
  {
    key: event.key,
    objectPrefix: feed.objectPrefix,
    request,
  },
  s3,
  bucket,
);

console.info({ event: "dev.completed", ...result });

import {
  ExecutionAlreadyExists,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import type { Handler } from "aws-lambda";
import { createHash } from "node:crypto";
import { assertFetcherEvent, type FetcherEvent, type FeedKey } from "@transit-analytics/shared/feeds";

type Event = FetcherEvent & {
  stateMachineArn: string;
  scheduleArn: string;
  stopAt?: string;
};

const sfn = new SFNClient({});

// A scheduled occurrence needs one retry-stable name using the restricted characters required for CloudWatch logging.
// https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html#API_StartExecution_RequestSyntax
// "To enable logging with CloudWatch Logs, the name should only contain 0-9, A-Z, a-z, - and _"
// https://medium.com/@shweta2202/step-functions-preventing-duplicate-executions-a4f5f2868381
export function createExecutionName(
  feedKeys: FeedKey[],
  scheduledTime: string,
): string {
  const prefix = feedKeys.length === 1 ? feedKeys[0] : createHash("sha256")
    .update(JSON.stringify(feedKeys)).digest("hex").slice(0, 32);
  return `${prefix}-${scheduledTime}`.replaceAll(/[^0-9A-Za-z_-]/g, "-");
}

export function createWorkflowInput(event: Event): string {
  return JSON.stringify({
    feedKeys: event.feedKeys,
    scheduledTime: event.scheduledTime,
  });
}

export const handler: Handler<Event, void> = async (event) => {
  assertFetcherEvent(event);
  if (event.stopAt !== undefined) {
    const deadline = Date.parse(event.stopAt);
    if (!Number.isFinite(deadline)) throw new Error("Invalid collection stopAt.");
    if (Date.now() >= deadline || Date.parse(event.scheduledTime) >= deadline) {
      console.info({ event: "workflow.collection_expired", scheduleArn: event.scheduleArn });
      return;
    }
  }
  const executionName = createExecutionName(
    event.feedKeys,
    event.scheduledTime,
  );

  try {
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: event.stateMachineArn,
        name: executionName,
        input: createWorkflowInput(event),
      }),
    );
  } catch (error) {
    if (error instanceof ExecutionAlreadyExists) {
      console.info({
        event: "workflow.execution_already_exists",
        executionName,
      });
      return;
    }
    throw error;
  }
};

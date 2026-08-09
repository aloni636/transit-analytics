import {
  ExecutionAlreadyExists,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import type { Handler } from "aws-lambda";
import type { FeedKey } from "../static-fetcher/feeds.js";

type Event = {
  stateMachineArn: string;
  scheduleArn: string;
  scheduledTime: string;
  feedKey: FeedKey;
};

const sfn = new SFNClient({});

// A scheduled occurrence needs one retry-stable name using the restricted characters required for CloudWatch logging.
// https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html#API_StartExecution_RequestSyntax
// "To enable logging with CloudWatch Logs, the name should only contain 0-9, A-Z, a-z, - and _"
// https://medium.com/@shweta2202/step-functions-preventing-duplicate-executions-a4f5f2868381
export function createExecutionName(
  feedKey: FeedKey,
  scheduledTime: string,
): string {
  return `${feedKey}-${scheduledTime}`.replaceAll(/[^0-9A-Za-z_-]/g, "-");
}

export const handler: Handler<Event, void> = async (event) => {
  const executionName = createExecutionName(
    event.feedKey,
    event.scheduledTime,
  );

  try {
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: event.stateMachineArn,
        name: executionName,
        input: JSON.stringify({
          feedKey: event.feedKey,
          scheduledTime: event.scheduledTime,
        }),
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

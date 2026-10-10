# Realtime collection

Build with `just build` from the repository root before planning Terraform. Renew
AWS credentials with `aws login`, configure registered AWS Console Mobile device
ARNs in `mobile_notification_channel_arns`, then deploy the dev environment.
If the notification hub already exists, import it instead of creating another:

```sh
terraform -chdir=infra/environments/dev import \
  module.transit_analytics.aws_notifications_notification_hub.realtime eu-central-1
```

Enable Notifications and allow push delivery in the AWS Console Mobile app.
Copy the mobile device ARN from its delivery channel in AWS User Notifications.
Terraform associates registered devices; it cannot register a phone or grant
its operating-system push permission.

From `transit-analytics/feed-fetcher`, validate and verify before collecting:

```sh
pnpm collection validate
pnpm collection test-notifications
pnpm collection notifications
```

Confirm that the test push appeared on the phone. An AWS notification event alone
does not establish phone receipt. Then run a short collection for explicitly selected feeds:

```sh
pnpm collection smoke GTFS_SWEDEN_3_TRIP_UPDATES_SL GTFS_SWITZERLAND_TRIP_UPDATES
```

Inspect
its manifest with `pnpm collection status .collections/<smoke-manifest>.json`.
Both feeds should have protobuf snapshots with metadata sidecars.

Run `pnpm collection start <FEED_KEY> [FEED_KEY ...]` for the feeds you want to collect
at a 60-second wait and one shared deadline 48 hours after launch. No feeds are
selected by default. The command prints and saves one execution ARN in `.collections/`.
Inspect progress and final completion with `pnpm collection status <manifest>`.
Set `AWS_REGION` if using a region other than the dev default `eu-central-1`.

## Static collection during the same period

`start` and `smoke` automatically copy the existing static EventBridge Scheduler
templates for the selected realtime feeds. Selecting multiple Swedish operators
still creates only one Swedish static schedule. The copies retain the original
cron expression, timezone, and target, but are enabled only for the collection's
start/stop dates and automatically deleted after completion. Originals are not
changed, and copies are recorded in the collection manifest outside Terraform.

Static downloads use the original provider-oriented cadence, not the realtime
one-minute polling interval. They run only when a cron occurrence falls within
the collection window; there is no immediate starting snapshot. In particular,
a two-minute smoke test can complete without downloading any static archive.

Redeploy Terraform before using this command so the `static_feed_schedules`
output and executor deadline check are available. The CLI's AWS identity needs
`scheduler:GetSchedule`, `scheduler:CreateSchedule`, `scheduler:DeleteSchedule`,
`states:StartExecution`, `states:DescribeExecution`, `states:StopExecution`, and
`iam:PassRole` for the existing static scheduler role. No new execution role is
created. Scheduler retries are disabled on copies; delayed executor invocations
are ignored after `stopAt`. Already-started fetches may finish after the deadline.

If launch fails partway, the manifest retains the realtime ARN and all planned
schedule names. Run the stop command below to clean up the partial collection.

## Manual realtime collection

For manually selected feeds, use **Start execution** on the realtime state
machine in the Step Functions Console:

```json
{
  "feedKeys": ["GTFS_SWEDEN_3_TRIP_UPDATES_SL", "GTFS_SWITZERLAND_TRIP_UPDATES"],
  "pollingSeconds": 60,
  "stopAt": "2026-10-12T18:00:00Z"
}
```

Console starts do not create temporary static schedules; use the CLI when you
want both static and realtime collection managed together.

Replace `stopAt` with the desired datetime, including its timezone. The workflow
uses whole-second precision. Each polling wait begins after the previous attempt;
a two-second fetch with a 60-second wait gives about 62 seconds between samples.
Each invocation fetches the selected feeds concurrently. If one fails, the others
still finish and retain their uploads; the invocation reports failure. Failures
appear in execution history and collection continues at the next sample.

Use the manifest status report or the Console's linked continuation executions
to locate the currently running execution. To stop the entire collection early:

```sh
pnpm collection stop .collections/<manifest>.json
```

The command removes that collection's temporary static schedules and stops the
currently active realtime continuation. Already-deleted schedules are harmless.
For Console-only starts without a manifest, stop the active execution through
the Console or `aws stepfunctions stop-execution` instead.

Stopping a finished ancestor does not stop its continuation. Inspect the chain
again after stopping in case a continuation started during the handoff. A stop
does not cancel a synchronous Lambda invocation already in progress.

## How alerts reach the phone

There is no alarm state in the Step Functions workflow. CloudWatch monitors the
realtime Lambda independently:

```text
Lambda built-in Duration / Errors metrics ───────────┐
Lambda JSON logs → rate-limit metric filter ─────────┤
                                                   ↓
CloudWatch alarm enters ALARM → AWS User Notifications → Console Mobile push
```

The duration alarm triggers when a completed invocation exceeds 20 seconds. The
error alarm triggers when an invocation fails, even if Step Functions catches
that failure and continues. The rate-limit alarm uses a CloudWatch Logs metric
filter matching `message.event = "fetch.rate_limited"`; the handler logs this
event for provider rate limits and rethrows the failure.

All three alarms evaluate one-minute periods. Notifications are sent when an
alarm enters ALARM, not for every sample while it remains there; an alarm can
notify again after recovering and subsequently entering ALARM. There is no exact
20-second alert cooldown or notification at the twentieth second of execution.
The notification rule listens for CloudWatch alarm state-change events, so an
SNS alarm action or an extra workflow invocation is not needed.

These alarms cover only the realtime Lambda, not static snapshot executions.
Inspect static execution status manually. Phone delivery also requires deployed
notification resources, a registered device ARN in `mobile_notification_channel_arns`,
and push permission in the mobile app. Use the test command above and confirm
receipt on the phone; configuration alone does not verify delivery.

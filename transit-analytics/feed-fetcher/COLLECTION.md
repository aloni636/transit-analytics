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

For manually selected feeds, use **Start execution** on the realtime state
machine in the Step Functions Console:

```json
{
  "feedKeys": ["GTFS_SWEDEN_3_TRIP_UPDATES_SL", "GTFS_SWITZERLAND_TRIP_UPDATES"],
  "pollingSeconds": 60,
  "stopAt": "2026-10-12T18:00:00Z"
}
```

Replace `stopAt` with the desired datetime, including its timezone. The workflow
uses whole-second precision. Each polling wait begins after the previous attempt;
a two-second fetch with a 60-second wait gives about 62 seconds between samples.
Each invocation fetches the selected feeds concurrently. If one fails, the others
still finish and retain their uploads; the invocation reports failure. Failures
appear in execution history and collection continues at the next sample.

Use the manifest status report or the Console's linked continuation executions
to locate the currently running execution. To stop the entire collection early:

```sh
aws stepfunctions stop-execution --region eu-central-1 \
  --execution-arn <currently-running-execution-arn>
```

Stopping a finished ancestor does not stop its continuation. Inspect the chain
again after stopping in case a continuation started during the handoff. A stop
does not cancel a synchronous Lambda invocation already in progress.

The three realtime alarms notify on ALARM state transitions. They report slow
invocations after metric publication and evaluation, rather than exactly at
second 20. Inspect realtime Lambda logs for feed keys, request IDs, provider
rate limits, and timeout details.

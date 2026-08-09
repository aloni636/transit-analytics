# TODOs

# First Priority

### Infra
- [X] Add Kafka compose service
- [X] Add Terraform
- [X] Add Terraform S3 backend:
    - [X] Add bootstrap/state/
    - [X] Use `use_lockfile`
    - [ ] Make sure to provide the necessary and only necessary [bucket policies](https://developer.hashicorp.com/terraform/language/backend/s3#permissions-required) when CI/CD.
- [X] Drop `-var-file=secrets.tfvars` in favor of `TF_VAR_*`
- [ ] ~~Introduce Airflow:~~
    - [ ] ~~Add Terraform MWAA-Serverless~~
    - [ ] ~~Include Python-to-YAML converter~~
    - [ ] ~~Add compose service~~
- [ ] Introduce Event-Bridge and Step-Functions:
    - [X] Pass `<aws.scheduler.schedule-arn>` and `<aws.scheduler.scheduled-time>` to the workflow executor using [EventBridge Scheduler context](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html).
    - [X] Use `sf-workflow-executor` to create a valid execution name and start the Standard workflow according to the [StartExecution name rules](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html#API_StartExecution_RequestSyntax) and this [idempotency article](https://medium.com/@shweta2202/step-functions-preventing-duplicate-executions-a4f5f2868381).
    - [X] Use JSONata and the [Step Functions context object](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-contextobject.html) to pass the original feed key and scheduled time to each task as their idempotency key.
    - [ ] Verify each provider's publication time, then enable its disabled EventBridge schedule.
    - [ ] Add provider-aware Step Functions task retry and backoff policies after observing actual failure modes.
- [ ] Add EMR serverless to Terraform
- [X] Add budget alerts.
- [ ] Use SSM Parameter Store `aws_ssm_parameter` with `SecureString`, `value_wo` and `value_wo_version ` to slash costs of `aws_secretsmanager_secret` (0$ per month for 1000 SecureStore strings VS 0.4$ per month for a single secret)
  - [ ] Switch from AWS Secrets Manager parameter store to SSM Parameter Store ([AWS Powertools docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/parameters/))

## Data Exploration
- [ ] Data Exploration:
    - [ ] Use Polars with Jupyter
    - [ ] Use PySpark

## Streaming
- [ ] ~~Add GTFS with [Java GTFS](https://gtfs.org/documentation/realtime/language-bindings/java/)~~ I prefer handling the data myself
- [ ] Use [Kafka Connect for Apache Iceberg](https://iceberg.apache.org/docs/nightly/kafka-connect/) as sink for normalized data Kafka topic
- [ ] Write Kafka normalization consumer in Scala 2.13 with `kafka-streams` (Java API)

## Fetchers
- [X] Add `@types/aws-lambda`
- [ ] Add CloudWatch alarms and an SNS email notification for failed or timed-out provider fetches.
- [X] GTFS static fetchers:
    - [X] Sweden
    - [X] Switzerland
    - [X] Germany
    - [ ] Some rural city in USA
    - [X] Make static-fetcher retries target the same logical S3 keys by using the scheduled event time instead of the Lambda start time.
- [ ] OSM fetcher
- [ ] Weather data with 1 hour cadence:
    - [ ] Sweden
    - [ ] Switzerland
    - [ ] Germany


# Second Priority
- [ ] ~~Add editorconfig~~ (will be relevant... never. I use vscode.)
- [ ] ~~Use SBT task runner and replace `./scripts` (tasks can use the sbt's builtin  `"<command>"!` syntax)~~ Use `justfile` to replace `./scripts`
- [ ] Add build, test and deploy tasks to `build.sbt`
- [ ] Consider SBT projects `sbt projects` for `gtfs-poller`, `streaming` or `raster-processing`
- [ ] Use Graviton for better price/performance:
    - [ ] `architectures = ["arm64"]` for AWS Lambda ([docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function#argument-reference))

## Infra
- [ ] Add OIDC authentication for Github <-> AWS CI/CD actions
- [ ] Move Lambda packages under `lambdas/` when enough functions exist to justify the extra directory.


## Fetchers
- [ ] Replace the TypeScript-only `FeedKey` and duplicated Terraform schedule map with a language-neutral JSON feed registry before Polars or Scala bronze-to-silver jobs depend on it.
- [ ] Conditionally fetch feeds based on etag or last-modified if proven trustworthy
- [ ] Include `<object>.metadata.json` generation within all fetchers. Include:
    - feed key
    - timestamps, duration
    - response metadata: etag, lastModified, httpStatus, url, content-length

# Third Priority
- [ ] Bump to Spark 3.5.8 and Geotrellis to 3.8.1

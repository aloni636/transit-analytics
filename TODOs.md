# TODOs

## First Priority

### Repo Migration
- [X] Migrate volumes:
    - [X] spark-events
    - [X] spark-work
    - [X] coursier-cache
    - [X] codex-cache
    - [X] aws-cache
- [X] Add uv:
    - [X] Drop `./requirements.txt` and replace it with top level `[tool.uv.workspace]`: `./transit-analytics/pyproject.toml`
    - [X] Add polars, polars-st, geopandas, shapely, numpy
    - [X] Add uv considerations (better monorepo support with workspaces)
- [X] Renames:
    - [X] data-pipeline -> spark
    - [X] fetchers -> nodejs
    - ~~transit-analytics -> apps~~
- [ ] Scala build tool:
    - [ ] Fix sbt.build paths
    - [ ] Replace sbt with mill
        - Add sbt consideration (DSL is annoying, I like to have multi-file builds and config colocate, declarative is simpler)

### CI/CD
- [ ] Split justfile to modules to enable parallel language specific CI/CD builds:
    - `just infra`
    - `just node [fmt|check|test|build]`
    - `just python [fmt|check|test|build]`
    - `just scala [fmt|check|test|build]`

### DX
- [ ] Add `./transit-analytics/tsconfig.base.json` to aggregate all different `tsconfig.json` in `./transit-analytics`
- [ ] Complete `./transit-analytics/shared/feeds.ts` because GTFS RT will also use it:
    - [ ] 

### Infra
- [X] Docker Compose local emulation:
    - [X] Add Kafka compose service
    - [ ] Add EMR serverless to Terraform
- [ ] Kafka:
    - [ ] ~~Add scheduled orchestration for GTFS-RT compaction (1 hour).~~ ~~(Use MSK Connect)~~
        - ~~Detect and log if no new protobuf files are present~~
    - [ ] Add 2 MSK `kafka.t3.small` instances
    - [ ] ~~Add ECS Kafka Connect instance with 0.5cpu and 2GB ram (instead of MSK Connect which is expensive at my scale)~~
    - [ ] Add a lambda batch consumer to persist Kafka GTFS-RT topic into iceberg table.
- [ ] Terraform:
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
- [X] Add budget alerts.
- [ ] Use SSM Parameter Store `aws_ssm_parameter` with `SecureString`, `value_wo` and `value_wo_version ` to slash costs of `aws_secretsmanager_secret` (0$ per month for 1000 SecureStore strings VS 0.4$ per month for a single secret)
    - [ ] Switch from AWS Secrets Manager parameter store to SSM Parameter Store ([AWS Powertools docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/parameters/))
- [ ] Asses if I need `@aws-sdk/client-secrets-manager` dependency.

### Data Exploration
- [ ] Data Exploration:
    - [ ] Add a Polars-based GTFS Static exploration notebook. 

### Streaming
- [ ] ~~Add GTFS with [Java GTFS](https://gtfs.org/documentation/realtime/language-bindings/java/)~~ I prefer handling the data myself.
- [ ] Use [Kafka Connect for Apache Iceberg](https://iceberg.apache.org/docs/nightly/kafka-connect/) as sink for normalized data Kafka topic
- [ ] Write GTFS-RT Kafka normalization and statistics consumer in Scala 2.13 with `kafka-streams` (Java API)
- [ ] GTFS-RT:
    - [ ] Examine eTag to verify if caching is possible. A durable eTag caching is needed.
    - [ ] Switzerland:
        - [ ] Stop fetching RT for switzerland at public holidays: "Please note: There is no update on public holidays (e.g. Easter Monday, Whit Monday, etc.).". We need to find a way to get all switzerland holidays.
    - [ ] 2 queries per minutes (sliding window). Handle rate limit:
        ```
        {
            "error": "Rate limit exceeded"
        }
        ```
    - [ ] Add `Accept-Encoding: zip` for GTFS static, add `User-Agent` with application name
    - [ ] Add `https://api.opentransportdata.swiss/la/gtfs-sa`
    - [ ] Add `https://api.opentransportdata.swiss/la/gtfs-rt`
    - [ ] Make sure to add `allow_redirects` for swiss

### Fetchers
- [X] Add `@types/aws-lambda`
- [ ] Add GTFS-RT raw Protobuf polling into Kafka ~~& S3 persistence~~ (I'll use Kafka Connect) (NodeJS).
- [ ] ~~Add GTFS-RT Protobuf -> Parquet periodic compaction (NodeJS):~~ \
    ~~`S3 protobuf objects -> async read -> protobuf decode -> appendRow() -> Parquet row-group buffer -> output stream`~~
- [ ] Include `parquet.js` into unzip and replace the raw write with parquet row-group buffer streaming: \
    `zip file -> async read -> txt/csv decode -> appendRow() -> Parquet row-group buffer -> output stream`
- [ ] ~~Consider Firehose and AWS Kinesis~~ (I need Kafka, and I'll run this project for only a week)
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


## Second Priority
- [ ] ~~Add editorconfig~~ (will be relevant... never. I use vscode.)
- [ ] ~~Use SBT task runner and replace `./scripts` (tasks can use the sbt's builtin  `"<command>"!` syntax)~~ Use `justfile` to replace `./scripts`
- [ ] Add build, test and deploy tasks to `build.sbt`
- [ ] Consider SBT projects `sbt projects` for `gtfs-poller`, `streaming` or `raster-processing`
- [ ] Use Graviton for better price/performance:
    - [ ] `architectures = ["arm64"]` for AWS Lambda ([docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function#argument-reference))
- [ ] Add lifecycle rule for raw data (because it'll get big real fast)

### Infra
- [ ] Add OIDC authentication for Github <-> AWS CI/CD actions
- [ ] Move Lambda packages under `lambdas/` when enough functions exist to justify the extra directory.
- [ ] Add CloudWatch alarms and an SNS email notification for failed or timed-out provider fetches.

### Fetchers
- [ ] Replace the TypeScript-only `FeedKey` and duplicated Terraform schedule map with a language-neutral JSON feed registry before Polars or Scala bronze-to-silver jobs depend on it.
- [ ] Conditionally fetch feeds based on etag or last-modified if proven trustworthy
- [ ] Include `<object>.metadata.json` generation within all fetchers. Include:
    - feed key
    - timestamps, duration
    - response metadata: etag, lastModified, httpStatus, url, content-length
- [ ] Split fetch and unzip into 2 lambdas: 
    - Raw fetch
    - S3 -> unzip -> parquet (check if I can use S3 seek to load zip async in parallel)

## Third Priority
- [ ] Bump to Spark 3.5.8 and Geotrellis to 3.8.1
- [ ] Migrate from multi workers per node to one worker and multiple executors ([see](https://spark.apache.org/docs/latest/core-migration-guide.html#upgrading-from-core-24-to-30)).
- [ ] Drop all Codex chat sessions whose `pwd` field is not transit-analytics
- [ ] 
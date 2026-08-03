# TODOs

# First Priority

### Infra
- [X] Add Kafka compose service
- [ ] Add Terraform
- [ ] Introduce Airflow:
    - [ ] Add Terraform MWAA-Serverless
    - [ ] Include Python-to-YAML converter
    - [ ] Add compose service
- [ ] Add EMR serverless to Terraform

## Data Exploration
- [ ] Data Exploration:
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

# Third Priority
- [ ] Bump to Spark 3.5.8 and Geotrellis to 3.8.1

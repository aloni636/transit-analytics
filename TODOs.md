# TODOs
## DX
- [ ] Add editorconfig
- [ ] Use SBT task runner and replace `./scripts` (tasks can use the sbt's builtin  `"<command>"!` syntax)
- [ ] Consider SBT projects `sbt projects` for `gtfs-poller`, `streaming` or `raster-processing`

- [X] ~~Split spark to compose ([image](https://hub.docker.com/layers/apache/spark/3.5.5/images/sha256-e331d996871621d5dfa13818df7e62a1ad547c78aaa23e0a2594fc343c07e2a4))~~
- [ ] Bump to Spark 3.5.8 and Geotrellis to 3.8.1

## Data Platform
### Streaming
- [X] Add Kafka compose service
- [ ] Convert Spark to compose service
    - [ ] Migrate volume mounts (temporary mount both new and old mounts to a basic image and `cp <old> <new>`)
- [ ] Data Exploration:
    - [ ] Add `Scala Plotly` for worksheets
    - [ ] Add `DuckDB UI`
- [ ] Write GTFS poller for Switzerland
- [ ] Write Kafka normalization consumer in Scala 2.13 with `kafka-streams` (Java API)
- [ ] Use [Kafka Connect for Apache Iceberg](https://iceberg.apache.org/docs/nightly/kafka-connect/) as sink for normalized data Kafka topic
- [ ] 

- [ ] Write GTFS poller for Germany
- [ ] Write GTFS poller for some rural city in USA
- [ ] Add more GTFS pollers until we have enough data

### Batching
- [ ] Add weather data with 1 hour cadence
    - [ ] Find weather source for Switzerland
    - [ ]  
- [ ] Add Airflow

### Infra
- [ ] Add Terraform:
    - [ ] Consider EMR serverless
    - [ ] [Integrate MWAA](https://docs.aws.amazon.com/emr/latest/EMR-Serverless-UserGuide/using-airflow.html)
    - Create S3 server side encryption key
    - Create KMS key for spark cluster communication (`emr-certificate.zip`)
    - Create EC2 keypair for primary node connection
    - Create a basic VPC network 
    - Create an EMR cluster with 1 `m4.large` primary and `c4.large` core

- [ ] CI/CD:
    - [ ] Refactor build.sbt (add task runner for deploy, test etc)

    - [ ] 
## Data
- [ ] Add GTFS with [Java GTFS](https://gtfs.org/documentation/realtime/language-bindings/java/)
- [ ] 
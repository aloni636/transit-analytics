# Feed fetcher

The declarative GTFS Static and GTFS-Realtime feed registry is located at `../shared/feeds.ts`. One fetcher artifact powers separate static and realtime Lambdas that store ZIPs, extracted files, and raw protobuf snapshots in S3.

See [Realtime collection](COLLECTION.md) for manual Console input, mobile
notification verification, and two-day collection commands.

## Provider documentation

Sweden:

- [Trafiklab GTFS overview](https://www.trafiklab.se/api/gtfs-datasets/overview/)
- [GTFS Sweden 3](https://www.trafiklab.se/api/gtfs-datasets/gtfs-sweden/)
- [GTFS Sverige 2](https://www.trafiklab.se/api/gtfs-datasets/gtfs-sverige-2/)
- [Creating Trafiklab API keys](https://www.trafiklab.se/docs/getting-started/using-trafiklab/)
- [Trafiklab request-frequency guidance](https://www.trafiklab.se/docs/using-trafiklab-data/best-practices/limiting-requests/)

Switzerland:

- [GTFS cookbook](https://opentransportdata.swiss/en/cookbook/timetable-cookbook/gtfs/)
- [Current 2026 timetable dataset](https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020)
- [Current-resource permalink](https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020/permalink)
- [API authentication](https://opentransportdata.swiss/en/cookbook/development-miscellaneous-cookbook/howto-access-apis/)
- [GTFS-Realtime](https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/)

Germany:

- [Available feeds](https://gtfs.de/en/feeds/)
- [Germany Full](https://gtfs.de/en/feeds/de_full/)
- [Latest full archive](https://download.gtfs.de/germany/free/latest.zip)
- [Free and paid services](https://gtfs.de/en/services/)
- [GTFS-Realtime](https://gtfs.de/en/realtime/)

The German static and realtime feeds are public. The realtime stream is updated
every ten seconds, but its agency coverage is not complete.

## Local development

From the fetcher devcontainer, use the project recipes for the normal feedback
cycle:

```sh
cd transit-analytics
just check
just build
just test
just verify
```

The lower-level one-shot fetch and debugger commands remain pnpm tasks:

```sh
cd feed-fetcher
pnpm dev GTFS_SWITZERLAND
pnpm debug GTFS_GERMANY
```

`pnpm dev <KEY>` performs one fetch. Realtime keys fetch a protobuf and its JSON HTTP-metadata sidecar. `pnpm debug <KEY>` waits for the Node
debugger before doing the same. There is intentionally no watch task because
fetching large provider archives continuously is not a useful development
cycle.

`pnpm test` starts an in-process HTTP provider, streams the committed
`test/fixtures/GTFS Sverige 2/sweden.zip` through the production upload path,
and verifies the resulting RustFS object by size and streaming SHA-256. It does
not contact a real provider or require provider credentials.

Logs use structured `console.info`, `console.warn`, and `console.error` objects.
Lambda emits them as JSON to `/aws/lambda/<function-name>` alongside AWS
`START`, `END`, and `REPORT` records. Terraform retains the log group for 14
days.

## Credentials and deployment

Local Trafiklab credentials are loaded by `dotenv` from the ignored
`.env.development` file:

```dotenv
GTFS_USER_AGENT="transit-analytics/feed-fetcher-dev"
GTFS_SWEDEN_3_STATIC_DATA="..."
GTFS_SVERIGE_2="..."
GTFS_SWEDEN_3_REALTIME_DATA="..."
GTFS_SWEDEN_3_SERVICE_ALERTS_DATA="..."
GTFS_SWITZERLAND_REALTIME_DATA="..."
```

Run `pnpm sync` to add missing development variable names to `.env.example`
without copying values. Public Swiss and German feeds need no local credential.

Lambda reads Swedish static/realtime credentials from `TRAFIKLAB_SECRET_ARN`
and Swiss realtime credentials from `OPENTRANSPORTDATA_SECRET_ARN`. AWS Lambda
Powertools handles Secrets Manager access, JSON transformation, and warm-runtime
caching. Germany and Swiss static feeds are public.

For CI, expose the values as GitHub Actions secrets and map them to
`TF_VAR_<VARIABLE_NAME>`. Terraform sends
them through ephemeral variables to Secrets Manager's write-only value, so the
credentials are not stored in plans or state. Increment
`TF_VAR_trafiklab_secret_version` when rotating either credential.

From `transit-analytics`, follow the one-time state-bucket bootstrap in
`infra/README.md`, run `just init dev`, then use `just plan dev` to build and
review the Terraform plan and `just deploy dev` to rebuild and apply. Both
commands validate the configuration, but backend initialization remains an
explicit setup step so Terraform cannot silently switch state locations. Future
CI should initialize once per fresh job before calling these recipes.

## Adding a feed

1. Add the feed definition, object prefix, auth method, and polling minimum to
   `../shared/feeds.ts`.
2. Add authenticated values to the appropriate local environment example and
   Terraform write-only provider secret.
3. Add or update the provider secret ARN permission and version counter.
4. Confirm redirects, response metadata, publication cadence, and its
   static/realtime version relationship.
5. Run `pnpm check`, `pnpm build`, `pnpm test`, and `pnpm dev <KEY>`.

## Local AWS emulation

RustFS is available at `http://rustfs:9000` inside Compose and
`http://localhost:9000` from the host. Its console uses port `9001`; VS Code
forwards that port and opens the console in a browser.

We considered [LocalStack](https://docs.localstack.cloud/aws/licensing/), but
currently only need local Lambda execution and S3, covered by direct TypeScript
invocation and RustFS. Its
[MWAA support](https://docs.localstack.cloud/aws/services/mwaa/) does not cover
our MWAA Serverless workflow, so we will reconsider it if broader AWS emulation
becomes necessary.

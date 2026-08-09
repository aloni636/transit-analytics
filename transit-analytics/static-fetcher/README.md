# Static fetcher

The GTFS-Static feeds supported by the TypeScript static fetcher are located at `./feeds.ts`.

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
cd apps/transit-analytics
just check
just build
just test
just verify
```

The lower-level one-shot fetch and debugger commands remain pnpm tasks:

```sh
cd static-fetcher
pnpm dev GTFS_SWITZERLAND
pnpm debug GTFS_GERMANY
```

`pnpm dev <KEY>` performs one fetch. `pnpm debug <KEY>` waits for the Node
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
GTFS_SWEDEN_3_STATIC_DATA="..."
GTFS_SVERIGE_2="..."
```

Run `pnpm sync` to add missing development variable names to `.env.example`
without copying values. Public Swiss and German feeds need no local credential.

Lambda reads both Swedish values from the provider-scoped secret identified by
`TRAFIKLAB_SECRET_ARN`. AWS Lambda Powertools handles Secrets Manager access,
JSON transformation, and warm-runtime caching.

For CI, expose the values as GitHub Actions secrets and map them to
`TF_VAR_<VARIABLE_NAME>`. Terraform sends
them through ephemeral variables to Secrets Manager's write-only value, so the
credentials are not stored in plans or state. Increment
`TF_VAR_trafiklab_secret_version` when rotating either credential.

From `apps/transit-analytics`, follow the one-time state-bucket bootstrap in
`infra/README.md`, run `just init dev`, then use `just plan dev` to build and
review the Terraform plan and `just deploy dev` to rebuild and apply. Both
commands validate the configuration, but backend initialization remains an
explicit setup step so Terraform cannot silently switch state locations. Future
CI should initialize once per fresh job before calling these recipes.

## Adding a feed

1. Add its object prefix and side-effect-free `createRequest` entry to
   `feeds.ts`.
2. For a public feed, construct its request without a credential.
3. For an existing authenticated provider, add its credential name to
   `.env.development`, run `pnpm sync`, and extend the provider's Terraform
   write-only secret JSON and GitHub Actions secrets.
4. For a new authenticated provider, add a provider secret, exact secret ARN
   permission, and request-header or query-parameter construction.
5. Increment the provider secret version when rotating credentials.
6. Confirm its publication schedule, validity horizon, redirects, and
   static/realtime version relationship in this README.
7. Run `pnpm check`, `pnpm build`, `pnpm test`, and `pnpm dev <KEY>`.

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

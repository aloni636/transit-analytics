# Transit Analytics

Transit Analytics compares public-transport reliability across countries using
route characteristics, population density, weather, and other operating
conditions. The first ingestion layer preserves provider files unchanged so
later normalization can account for differences between GTFS schemas and
providers.

## Research questions

The project needs to establish:

1. Which static feed matches each realtime feed?
2. How can a realtime snapshot be associated with the correct static version?
3. What constitutes one normalized delay observation?
4. How do we distinguish missing realtime data from an on-time trip?
5. Which raw, normalized, and derived datasets must be retained?

The initial hypotheses and minimum data are:

| Question | Hypothesis | Minimum data |
| --- | --- | --- |
| When is transit least reliable? | Peak periods and weekday congestion increase delays. | Delay, timestamp, weekday/weekend |
| Do road types matter? | Local-road routes are less reliable than highway routes. | Route geometry, road classification |
| Do incidents matter? | Accidents and disruptions cause localized delay spikes. | Incident events, route geometry |
| Does car dependence matter? | High private-vehicle use affects bus reliability. | Vehicle ownership, parking, population |
| Does route context matter? | Long intracity routes accumulate delay through stops and junctions. | Route length, category, stops, junctions |
| Is separated transit more reliable? | Rail and segregated light rail outperform road-sharing services. | Mode, right of way, grade crossings |
| Does demand matter? | High ridership increases dwell time and delay variance. | Ridership, stop-level delay |
| Does weather matter? | Rain, snow, ice, wind, heat, and low visibility reduce reliability. | Weather observations joined by place and time |

Candidate derived features include expected route speed, stop and junction
density, population and point-of-interest density, peak/off-peak periods,
vehicle ownership, congestion, incidents, and infrastructure separation.

## Data architecture

The current fetcher writes immutable provider archives to the raw layer:

```text
provider -> raw object archive -> normalization -> analytical datasets
```

The dedicated data-lake bucket starts directly with:

```text
raw/<location>/<data-type>/<feed>/YYYY/MM/DD/<UTC timestamp>.zip
```

Future work can normalize the raw archives into comparable static and realtime
models, maintain live state, and produce historical aggregates. Raw data remains
provider-shaped; downstream processing owns schema reconciliation and nullable
differences.

## Static fetcher

The TypeScript static fetcher supports four country-level feeds:

| Key | Coverage | Authentication | Freshness | Raw prefix |
| --- | --- | --- | --- | --- |
| `GTFS_SWEDEN_3` | Detailed Swedish data, but not every operator | Trafiklab query key | Daily, typically 05:00–06:00 | `raw/sweden/gtfs-static/gtfs-sweden-3` |
| `GTFS_SVERIGE_2` | All Swedish public transport with less detail | Trafiklab query key | Updated when data changes, at most daily | `raw/sweden/gtfs-static/gtfs-sverige-2` |
| `GTFS_SWITZERLAND` | Current Swiss timetable year | None for the static catalog download | Normally Monday and Thursday; the timetable-year permalink changes annually | `raw/switzerland/gtfs-static/gtfs-switzerland` |
| `GTFS_GERMANY` | Nationwide full German feed | None | The free-feed pages disagree between a seven-day horizon and 30-day validity; use feed metadata | `raw/germany/gtfs-static/gtfs-germany` |

Each feed constructs a native `Request` without performing I/O. This keeps
provider authentication where it belongs: Trafiklab request factories add the
`key` query parameter, while the Swiss and German factories return public
requests. The fetcher follows redirects and streams the response into S3 using
multipart upload without buffering the complete archive in memory.

### Provider documentation

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

The static catalog download is public. Swiss APIs that require credentials use
an `Authorization: Bearer <key>` header, generally require a `User-Agent`, and
may redirect. The realtime feed is coordinated with particular static versions,
so downstream processing must retain and use feed-version metadata.

Germany:

- [Available feeds](https://gtfs.de/en/feeds/)
- [Germany Full](https://gtfs.de/en/feeds/de_full/)
- [Latest full archive](https://download.gtfs.de/germany/free/latest.zip)
- [Free and paid services](https://gtfs.de/en/services/)
- [GTFS-Realtime](https://gtfs.de/en/realtime/)

The German static and realtime feeds are public. The realtime stream is updated
every ten seconds, but its agency coverage is not complete.

### Local development

From the fetcher devcontainer:

```sh
cd apps/transit-analytics/static-fetcher
pnpm check
pnpm build
pnpm test
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

### Credentials and deployment

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
`TF_VAR_gtfs_sweden_3_static_data` and `TF_VAR_gtfs_sverige_2`. Terraform sends
them through ephemeral variables to Secrets Manager's write-only value, so the
credentials are not stored in plans or state. Increment
`TF_VAR_trafiklab_secret_version` when rotating either credential. The eventual
workflow should authenticate to AWS through GitHub OIDC rather than long-lived
AWS access keys.

Checks, builds, integration tests, and `terraform validate` do not need provider
keys. Running a Swedish feed locally requires its corresponding key, and a
Terraform deployment requires both Trafiklab values. The GTFS Sverige 2 value
can remain absent until that feed is invoked or deployed.

### Adding a feed

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

### Local AWS emulation

RustFS is available at `http://rustfs:9000` inside Compose and
`http://localhost:9000` from the host. Its console uses port `9001`; VS Code
forwards that port and opens the console in a browser.

Inside the devcontainer, `getent hosts rustfs` verifies Compose DNS. An
unauthenticated `curl http://rustfs:9000/` returning `403` confirms connectivity
to the S3 endpoint.

We considered [LocalStack](https://docs.localstack.cloud/aws/licensing/), but
currently only need local Lambda execution and S3, covered by direct TypeScript
invocation and RustFS. Its
[MWAA support](https://docs.localstack.cloud/aws/services/mwaa/) does not cover
our MWAA Serverless workflow, so we will reconsider it if broader AWS emulation
becomes necessary.

## Future and postponed sources

Israel is postponed because access to its static public-transport data requires
the Ministry of Transport to allowlist a static IPv4 address. Relevant sources
are the [static-data page](https://www.gov.il/he/pages/gtfs_general_transit_feed_specifications),
and [realtime-data page](https://www.gov.il/he/pages/real_time_information_siri).

London remains a possible later source; its unified API requires registration,
and available GTFS-Realtime feeds can also be surveyed through
[Transitland](https://www.transit.land/feeds?feedSpecs=GTFS_RT).

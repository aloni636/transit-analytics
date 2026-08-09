# Transit Analytics

Transit Analytics compares public-transport reliability across countries using
route characteristics, population density, weather, and other operating
conditions. The first ingestion layer preserves provider files unchanged so
later normalization can account for differences between GTFS schemas and
providers.

## Infrastructure considerations

We use Event-Bridge for scheduling and Step-Functions for task orchestration
because an always-on Airflow MWAA instance is wasteful at this workload scale. \
We don't use MWAA serverless because [it is not yet integrated with Terraform](https://github.com/hashicorp/terraform-provider-aws/issues/45254),
it requires SageMaker studio, and it [doesn't seem to support timezones](https://github.com/awslabs/python-to-yaml-dag-converter-mwaa-serverless/blob/70a1cea865c229ecf24f8ab96536dc28fa93d71f/dag_converter/conversion/schedule.py#L18) (which are
required for feeds of different timezones).

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

## Future and postponed sources

Israel is postponed because access to its static public-transport data requires
the Ministry of Transport to allowlist a static IPv4 address. Relevant sources
are the [static-data page](https://www.gov.il/he/pages/gtfs_general_transit_feed_specifications),
and [realtime-data page](https://www.gov.il/he/pages/real_time_information_siri).

London remains a possible later source; its unified API requires registration,
and available GTFS-Realtime feeds can also be surveyed through
[Transitland](https://www.transit.land/feeds?feedSpecs=GTFS_RT).

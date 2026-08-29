# ---
# jupyter:
#   jupytext:
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#       jupytext_version: 1.19.5
#   kernelspec:
#     display_name: transit-analytics (3.13.5)
#     language: python
#     name: python3
# ---

# %% [markdown]
# # GTFS Static/RT Analysis

# %% [markdown]
# ## Setup

# %%
from IPython.display import HTML, display


def display_horizontal(*items):
    html = "".join(
        f"<div>{x._repr_html_() if hasattr(x, '_repr_html_') else f'<pre>{x}</pre>'}</div>"
        for x in items
    )
    display(
        HTML(f'<div style="display:flex; gap:1em; align-items:flex-start">{html}</div>')
    )


# %%
import pathlib
from datetime import UTC, datetime


def s3_key_to_datetime(s3_key: str):
    stem = pathlib.Path(s3_key).stem
    return datetime.strptime(stem, r"%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)


# %%
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

# %% [markdown]
# ## GTFS Sweden

# %%
import boto3
from botocore.client import Config
from types_boto3_s3.client import S3Client

# https://docs.rustfs.com/en/developer/sdk/python
s3: S3Client = boto3.client(
    "s3",
    endpoint_url="http://rustfs:9000",
    aws_access_key_id="rustfsadmin",
    aws_secret_access_key="rustfsadmin",
    region_name="us-east-1",
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},
    ),
)
response = s3.list_buckets()
for bucket in response["Buckets"]:
    print(bucket.get("Name"))


# %%
# GTFS Static and GTFS Realtime must match each other date
# SWEDEN_GTFS_STATIC_ZIP is refreshed daily at between 05:00 and 06:00
# SWEDEN_GTFS_REALTIME_PBS are refreshed every 30 seconds
BUCKET = r"transit-analytics-dev"
SWEDEN_GTFS_STATIC_ZIP = (
    "raw/sweden/gtfs-static/gtfs-sweden-3/2026/08/28/20260828T172458Z.zip"
)
# You can download protobuf files and store them in RustFS like this:
# ```
# set -a && source .env.development && set +a
# curl -fL --compressed   "https://opendata.samtrafiken.se/gtfs-rt-sweden/ul/TripUpdatesSweden.pb?key=$GTFS_SWEDEN_3_REALTIME" |
# rc pipe "local/transit-analytics-dev/raw/sweden/gtfs-rt/ul/$(date -u +'%Y/%m/%d/%Y%m%dT%H%M%SZ').pb"
# ```
SWEDEN_GTFS_REALTIME_PBS = [
    "raw/sweden/gtfs-rt/ul/2026/08/28/20260828T174640Z.pb",
    "raw/sweden/gtfs-rt/ul/2026/08/28/20260828T174918Z.pb",
    "raw/sweden/gtfs-rt/ul/2026/08/28/20260828T175054Z.pb",
    "raw/sweden/gtfs-rt/ul/2026/08/28/20260828T175201Z.pb",
]

# %%
import tempfile

# NOTE: Make sure to call `tmp.cleanup()` at the end
tmp = tempfile.TemporaryDirectory()
tmpdir = pathlib.Path(tmp.name)

# %%
import zipfile

gtfs_static_zip_path = tmpdir / pathlib.Path(SWEDEN_GTFS_STATIC_ZIP).name

if not gtfs_static_zip_path.exists():
    log.info(
        f"Fetching from S3: {SWEDEN_GTFS_STATIC_ZIP!r} -> {gtfs_static_zip_path!r}"
    )
    s3.download_file(BUCKET, SWEDEN_GTFS_STATIC_ZIP, gtfs_static_zip_path)

tmp_extracted_path = gtfs_static_zip_path.with_name(gtfs_static_zip_path.stem)
if not tmp_extracted_path.exists():
    log.info("Extracting zip: ")
    with zipfile.ZipFile(gtfs_static_zip_path, "r") as zip_ref:
        zip_ref.extractall(tmp_extracted_path)


# %%
print(*sorted(tmp_extracted_path.iterdir()), sep="\n")

# %%
import polars as pl

# Get agencies to fetch the appropriate GTFS-RT operator
agency = pl.read_csv(tmp_extracted_path / "agency.txt")
agency.schema

# %%
with pl.Config(tbl_rows=None):  # set to -1 to prevent truncation
    display_horizontal(
        agency.select(
            "*",
        ).filter(pl.col("agency_name").str.find(r"^\d+$").is_not_null()),
        agency.select(pl.col("agency_lang").unique()),
        agency.select(pl.col("agency_name").unique()),
    )

# %%
gtfs_rt_file = SWEDEN_GTFS_REALTIME_PBS[0]
gtfs_rt_path = tmpdir / pathlib.Path(gtfs_rt_file).name
gtfs_rt_timestamp = s3_key_to_datetime(gtfs_rt_file)

if not gtfs_rt_path.exists():
    log.info(f"Fetching from S3: {gtfs_rt_file!r} -> {gtfs_rt_path!r}")
    s3.download_file(BUCKET, gtfs_rt_file, gtfs_rt_path)

# %%
from google.transit import gtfs_realtime_pb2

feed = gtfs_realtime_pb2.FeedMessage()
with open(gtfs_rt_path, "rb") as f:
    feed.ParseFromString(f.read())

# %%
count = 0
for entity in feed.entity:
    count += 1
    if entity.HasField("trip_update"):
        print(entity.trip_update)
print(f"There are {count} entities")

# %%
rt_entities = pl.from_dicts(
    [
        {
            "has_trip_update": entity.HasField("trip_update"),  # TripUpdate
            "has_vehicle": entity.HasField("vehicle"),  # VehiclePosition
            "has_alert": entity.HasField("alert"),  # Alert
        }
        for entity in feed.entity
    ]
)

# %%
# Validate: "Exactly one of the following fields must be present" (gtfs-realtime.proto)
event_types_count = rt_entities.select(
    pl.col("has_trip_update").sum().name.suffix("_count"),
    pl.col("has_vehicle").sum().name.suffix("_count"),
    pl.col("has_alert").sum().name.suffix("_count"),
)
display(event_types_count)
assert event_types_count.select(
    assertion_value=pl.sum_horizontal(
        pl.col("has_trip_update_count") > 1,
        pl.col("has_vehicle_count") > 1,
        pl.col("has_alert_count") > 1,
    )
    == 1
).item()

# %%
from google.protobuf import json_format

# You can download the protobuf schema here: https://gtfs.org/documentation/realtime/gtfs-realtime.proto
single_entity = feed.entity[0]
print(json_format.MessageToJson(single_entity))

# %% [markdown]
# ### Trip Updates

# %%
trip_updates = pl.from_dicts(
    [
        {
            "id": entity.id,
            "vehicle_id": entity.trip_update.vehicle.id,
            "vehicle_label": entity.trip_update.vehicle.label,
            "trip_id": entity.trip_update.trip.trip_id,
            "wheelchair_accessible": entity.trip_update.vehicle.wheelchair_accessible,  # UNKNOWN = 1; WHEELCHAIR_ACCESSIBLE = 2; WHEELCHAIR_INACCESSIBLE = 3;
            "stop_time_update_count": len(entity.trip_update.stop_time_update),
        }
        for entity in feed.entity
    ]
)
display(trip_updates, trip_updates.describe())


# %%
import altair as alt

# Conclusion: A left skewed distribution of UL trip_update event counts for each entity
# Peak of 90 entries at 18.8-27.2 events each
trip_updates.get_column("stop_time_update_count").hist().plot.bar(
    x=alt.X("category", sort=alt.SortField("breakpoint", order="ascending")), y="count"
)

# %%
# Conclusion: All UL vehicle_id instances are unique
trip_updates.get_column("vehicle_id").value_counts().get_column("count").max()

# %%
# Expanding stop_time_update should contain 3845 entires
trip_updates.get_column("stop_time_update_count").sum()

# %%
# Conclusion: All UL entities are unknown to be wheelchair accessible
display(trip_updates.group_by("wheelchair_accessible").agg(pl.len()))

# Conclusion: All UL entities have empty string vehicle label
display(trip_updates.get_column("vehicle_label").unique())

# Conclusion: All UL Ids are unique per entity
display(trip_updates.get_column("id").value_counts().get_column("count").max())

# %% [markdown]
# ---

# %%
with open(tmp_extracted_path / "trips.txt") as f:
    print(f.readlines(100))

# %%
# Get trips and routes to get the vehicle type
trips = pl.read_csv(
    tmp_extracted_path / "trips.txt",
    schema={
        "route_id": pl.String(),
        "service_id": pl.String(),
        "trip_id": pl.String(),
        "trip_headsign": pl.String(),
        "trip_short_name": pl.String(),
        "direction_id": pl.Int64(),
        "shape_id": pl.String(),
        "samtrafiken_internal_trip_number": pl.Int64(),
    },
)
routes = pl.read_csv(
    tmp_extracted_path / "routes.txt",
    schema={
        "route_id": pl.String(),
        "agency_id": pl.String(),
        "route_short_name": pl.String(),
        "route_long_name": pl.String(),
        "route_type": pl.Int64(),
        "route_desc": pl.String(),
    },
)

trip_updates_with_route_type = trip_updates.join(
    trips.select("trip_id", "route_id").join(
        routes.select("route_id", "route_type"),
        on="route_id",
        how="left",
        validate="m:1",
    ),
    on="trip_id",
    how="left",
    validate="m:1",
)
trip_updates_with_route_type

# %%
# https://developers.google.com/transit/gtfs/reference/extended-route-types
# https://gtfs.org/documentation/schedule/reference/#routestxt is not valid and was extended by Google
route_type_names = pl.DataFrame(
    schema={"route_type": pl.Int64(), "route_type_name": pl.String()},
    orient="row",
    data=[
        (100, "Railway Service"),  # Examples: Not applicable (N/A)
        (101, "High Speed Rail Service"),  # Examples: TGV (FR), ICE (DE), Eurostar (GB)
        (102, "Long Distance Trains"),  # Examples: InterCity/EuroCity
        (
            103,
            "Inter Regional Rail Service",
        ),  # Examples: InterRegio (DE), Cross County Rail (GB)
        (104, "Car Transport Rail Service"),  # Examples: N/A
        (105, "Sleeper Rail Service"),  # Examples: GNER Sleeper (GB)
        (106, "Regional Rail Service"),  # Examples: TER (FR), Regionalzug (DE)
        (107, "Tourist Railway Service"),  # Examples: Romney, Hythe & Dymchurch (GB)
        (
            108,
            "Rail Shuttle (Within Complex)",
        ),  # Examples: Gatwick Shuttle (GB), Sky Line (DE)
        (
            109,
            "Suburban Railway",
        ),  # Examples: S-Bahn (DE), RER (FR), S-tog (Kopenhagen)
        (110, "Replacement Rail Service"),  # Examples: N/A
        (111, "Special Rail Service"),  # Examples: N/A
        (112, "Lorry Transport Rail Service"),  # Examples: N/A
        (113, "All Rail Services"),  # Examples: N/A
        (114, "Cross-Country Rail Service"),  # Examples: N/A
        (115, "Vehicle Transport Rail Service"),  # Examples: N/A
        (
            116,
            "Rack and Pinion Railway",
        ),  # Examples: Rochers de Naye (CH), Dolderbahn (CH)
        (117, "Additional Rail Service"),  # Examples: N/A
        (200, "Coach Service"),  # Examples: N/A
        (201, "International Coach Service"),  # Examples: EuroLine, Touring
        (202, "National Coach Service"),  # Examples: National Express (GB)
        (
            203,
            "Shuttle Coach Service",
        ),  # Examples: Roissy Bus (FR), Reading-Heathrow (GB)
        (204, "Regional Coach Service"),  # Examples: N/A
        (205, "Special Coach Service"),  # Examples: N/A
        (206, "Sightseeing Coach Service"),  # Examples: N/A
        (207, "Tourist Coach Service"),  # Examples: N/A
        (208, "Commuter Coach Service"),  # Examples: N/A
        (209, "All Coach Services"),  # Examples: N/A
        (400, "Urban Railway Service"),  # Examples: N/A
        (401, "Metro Service"),  # Examples: Métro de Paris
        (402, "Underground Service"),  # Examples: London Underground, U-Bahn
        (403, "Urban Railway Service"),  # Examples: N/A
        (404, "All Urban Railway Services"),  # Examples: N/A
        (405, "Monorail"),  # Examples: N/A
        (700, "Bus Service"),  # Examples: N/A
        (701, "Regional Bus Service"),  # Examples: Eastbourne-Maidstone (GB)
        (702, "Express Bus Service"),  # Examples: X19 Wokingham-Heathrow (GB)
        (
            703,
            "Stopping Bus Service",
        ),  # Examples: 38 London: Clapton Pond-Victoria (GB)
        (704, "Local Bus Service"),  # Examples: N/A
        (705, "Night Bus Service"),  # Examples: N prefixed buses in London (GB)
        (706, "Post Bus Service"),  # Examples: Maidstone P4 (GB)
        (707, "Special Needs Bus"),  # Examples: N/A
        (708, "Mobility Bus Service"),  # Examples: N/A
        (709, "Mobility Bus for Registered Disabled"),  # Examples: N/A
        (710, "Sightseeing Bus"),  # Examples: N/A
        (711, "Shuttle Bus"),  # Examples: 747 Heathrow-Gatwick Airport Service (GB)
        (712, "School Bus"),  # Examples: N/A
        (713, "School and Public Service Bus"),  # Examples: N/A
        (714, "Rail Replacement Bus Service"),  # Examples: N/A
        (715, "Demand and Response Bus Service"),  # Examples: N/A
        (716, "All Bus Services"),  # Examples: N/A
        (800, "Trolleybus Service"),  # Examples: N/A
        (900, "Tram Service"),  # Examples: N/A
        (901, "City Tram Service"),  # Examples: N/A
        (
            902,
            "Local Tram Service",
        ),  # Examples: Munich (DE), Brussels (BE), Croydon (GB)
        (903, "Regional Tram Service"),  # Examples: N/A
        (904, "Sightseeing Tram Service"),  # Examples: Blackpool Seafront (GB)
        (905, "Shuttle Tram Service"),  # Examples: N/A
        (906, "All Tram Services"),  # Examples: N/A
        (1000, "Water Transport Service"),  # Examples: N/A
        (1100, "Air Service"),  # Examples: N/A
        (1200, "Ferry Service"),  # Examples: N/A
        (
            1300,
            "Aerial Lift Service",
        ),  # Examples: Telefèric de Montjuïc (ES), Saleve (CH), Roosevelt Island Tramway (US)
        (1301, "Telecabin Service"),  # Examples: N/A
        (1302, "Cable Car Service"),  # Examples: N/A
        (1303, "Elevator Service"),  # Examples: N/A
        (1304, "Chair Lift Service"),  # Examples: N/A
        (1305, "Drag Lift Service"),  # Examples: N/A
        (1306, "Small Telecabin Service"),  # Examples: N/A
        (1307, "All Telecabin Services"),  # Examples: N/A
        (1400, "Funicular Service"),  # Examples: Rigiblick (Zürich, CH)
        (1500, "Taxi Service"),  # Examples: N/A
        (1501, "Communal Taxi Service"),  # Examples: Marshrutka (RU), dolmuş (TR)
        (1502, "Water Taxi Service"),  # Examples: N/A
        (1503, "Rail Taxi Service"),  # Examples: N/A
        (1504, "Bike Taxi Service"),  # Examples: N/A
        (1505, "Licensed Taxi Service"),  # Examples: N/A
        (1506, "Private Hire Service Vehicle"),  # Examples: N/A
        (1507, "All Taxi Services"),  # Examples: N/A
        (1700, "Miscellaneous Service"),  # Examples: N/A
        (1702, "Horse-drawn Carriage"),  # Examples: N/A
    ],
)

# %%
# Conclusion: All UL route_types are bus services.
trip_updates_with_route_type.get_column("route_type").value_counts().join(
    route_type_names, on="route_type", how="left"
)

# %% [markdown]
# ### Stop Time Event

# %%
stop_time_updates = pl.from_dicts(
    [
        {
            "entity_id": entity.id,
            # trip_update.<arrival|departure> are StopTimeEvent
            "arrival_time": trip_update.arrival.time,
            "arrival_delay": trip_update.arrival.delay,
            "arrival_uncertainty": trip_update.arrival.uncertainty,
            "departure_time": trip_update.departure.time,
            "departure_delay": trip_update.departure.delay,
            "departure_uncertainty": trip_update.departure.uncertainty,
            "stop_sequence": trip_update.stop_sequence,  # fk to stop_times.txt
            "stop_id": trip_update.stop_id,  # fk to stops.txt
            "assigned_stop_id": trip_update.stop_time_properties.assigned_stop_id,  # fk to stops.txt
            "schedule_relationship": trip_update.schedule_relationship,  # SCHEDULED = 0; SKIPPED = 1; UNSCHEDULED = 3;
        }
        # trip_update.stop_time_update is StopTimeUpdate
        for entity in feed.entity
        for trip_update in entity.trip_update.stop_time_update
    ]
)

# %%
# Assert nested comprehension trip_updates unpacking executed correctly
TEST_ENTITY_ID = "33010502165557001"
display(
    trip_updates.filter(pl.col("id") == TEST_ENTITY_ID),
    stop_time_updates.filter(pl.col("entity_id") == TEST_ENTITY_ID),
)

assert (
    len(stop_time_updates.filter(pl.col("entity_id") == TEST_ENTITY_ID))
    == trip_updates.filter(pl.col("id") == TEST_ENTITY_ID)
    .get_column("stop_time_update_count")
    .first()
)

# %%
stop_time_updates_clean = stop_time_updates.select(
    "entity_id",
    pl.from_epoch("arrival_time", time_unit="s").dt.replace_time_zone("UTC"),
    "arrival_delay",
    "arrival_uncertainty",
    pl.from_epoch("departure_time", time_unit="s").dt.replace_time_zone("UTC"),
    "departure_delay",
    "departure_uncertainty",
)

stop_time_updates_clean

# %%
# GTFS RT "should return all departures up till 10 minutes in the past.
# Once a departure/arrival has been observed, uncertainty for that departure/arrival is set to "0"."
# https://support.trafiklab.se/org/trafiklabse/d/gtfs-rt-departure-times-accuracy/
stop_time_updates_clean.select(
    arrival_time_min_gtfs_rt_event_delay=(
        pl.col("arrival_time") - pl.lit(gtfs_rt_timestamp)
    ).min(),
    arrival_time_max_gtfs_rt_event_delay=(
        pl.col("arrival_time") - pl.lit(gtfs_rt_timestamp)
    ).max(),
    departure_time_min_gtfs_rt_event_delay=(
        pl.col("departure_time") - pl.lit(gtfs_rt_timestamp)
    ).min(),
    departure_time_max_gtfs_rt_event_delay=(
        pl.col("departure_time") - pl.lit(gtfs_rt_timestamp)
    ).max(),
)
# Conclusion: Not 10 minutes, but at least 15 minutes

# %%
stop_time_updates.select("stop_id", "stop_sequence", "assigned_stop_id").describe()
# Conclusion: both stop_id and stop_sequence are present; assigned_stop_id is "" (experimental field)

# %%

# %% [markdown]
# ---

# %% [markdown]
# ![](https://opentransportdata.swiss/wp-content/uploads/2016/11/gtfs_static-1024x761.png)

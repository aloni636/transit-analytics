# Workflow
`sbt` is your friend - that's how you execute scala:
```sh
sbt
sbt:learning-scala-root> exercises/run
```

## Running Exercises
I use a **CLI argument dispatcher**, so you select an exercise by its object name and run it: `sbt "exercises/run Ex01"`. View all available exercises by running `sbt exercises/run`.

## Creating Exercises
Create a new `Ex<>` file in `apps/exercises/src/main/scala`, and add an `Exercise` object with a `run` method. After that, add it to the exercise list in `apps/exercises/src/main/scala/Main.scala` and run it with `sbt "exercises/run Ex<>"`.

## Running Spark Exercises
A spark standalone cluster is automatically started when the devcontainer is created, available at `spark://localhost:7077`. 

You can monitor the Spark cluster at `http://localhost:8080`, the history server at `http://localhost:18080`, and more granularly at `$SPARK_HOME/logs/`.

## Interactive Shells
You have 3 ways to experiment interactively with Scala: `spark-shell` / `sbt console`, `jupyterlab` or `worksheets`.

### Shell
You can experiment interactively in a spark configured console using:

```sh
spark-shell --master spark://localhost:7077
```

To have all the dependencies, use this instead: 
```sh
sbt exercises/console
...
scala> import org.apache.spark.sql.SparkSession
scala> val spark = SparkSession.builder()
        .appName("console")
        .master(s"spark://localhost:7077")
        .getOrCreate()
```

### Jupyterlab
A Jupyter-lab server is also automatically started (with Almond Scala kernel, Metals LSP support and jupytext).

Open it by looking for the Jupyter URL in `.jupyter.log` file, or run:

```sh
jupyter server list
# Currently running servers:
# http://127.0.0.1:8888/?token=<TOKEN> :: /workspaces/learning-scala
```

All notebooks are stored in `./notebooks` as jupytext files (those are easier to manage with git).

To stop Jupyter, run `./scripts/stop-jupyter.sh`.

Note: VSCode notebooks do not communicate correctly with Almond kernel, leading to non existent autocomplete support, so I recommend using Jupyter Lab directly.

### Worksheets
Worksheets provide interactive computation with tight integration to `sbt`. The directory `./worksheets` supports worksheets using VSCode's Metals and automatically provides all the required dependencies.

# Downloading Data
*TLDR:*

```sh
source ./.venv/bin/activate
./scripts/download-taxi.sh
./scripts/download-himalayas.sh
./scripts/download-natural-earth.sh      
./scripts/download-himalayas-vectors.sh  
```

Exercise 6 (`./src/main/scala/Ex06.scala`) requires part of the **NYC TLC dataset**. Fetch it using `./scripts/download-taxi.sh`.

Exercise 7 (`./src/main/scala/Ex07.scala`) requires the **Copernicus dataset**. Fetching it is complex enough to require Python scripting. The Python environment is automatically configured, but **the `.venv` must be activated!** If VSCode doesn't activate it when you open the integrated terminal, run `source ./.venv/bin/activate` before running `./scripts/download-himalayas.sh`

# Projections
In **exercise 7** (`Ex07`) I used a custom projection to perform projected analysis of the Himalayas without UTM stitching. To evaluate it (and other projections) I performed CRS distortion analysis which you can read about here: [**Projection Considerations**](PROJECTIONS.md).

# Debugging

## Dependencies Hell
Use **Graphviz Interactive Preview** extension to analyze & debug sbt's dependency graph:
```sh
sbt exercises/dependencyDot
# ...
# [info] Wrote dependency graph to '/workspaces/learning-scala/apps/exercises/target/dependencies-compile.dot'
```

## Docker
The quickest build debug cycle for devcontainer is: edit `./.devcontainer` content, run `docker build -f .devcontainer/Dockerfile .`, debug and repeat. Once it builds run VSCode's *`Dev Containers: Rebuild and Reopen in Container`*.

## Spark Driver logs
Driver logs are persisted in `/var/spark-events/driverLog`. Unfortunately I couldn't manage to display them in History Server UI, so you'll have to read them via your terminal.

## Logs
Spark logs are configured in `/config/spark/log4j2.properties`. Test logs for `apps/exercises` are configured in `apps/exercises/src/main/resources/log4j2.properties`. When testing, a dedicated set of logs are produced in `.logs/`, one per JVM test process (each test is a JVM fork to guarantee each JVM manages only one local Spark instance).

As for enabling debug level logging, modify `logger.learningscala.level = warn` in `apps/exercises/src/main/resources/log4j2.properties`.

# Spark Version

We use **Spark 3.5.5** because **Geotrellis 3.8.0** depends on Spark 3.5.5 (see [`project/Dependencies.scala`](https://github.com/locationtech/geotrellis/blob/master/project/Dependencies.scala)).

Note that **Geotrellis 3.8.1** supports **Spark 3.5.8**. Note that Geotrellis master merged [#3582](https://github.com/locationtech/geotrellis/pull/3582) which bumped Spark version to **Spark 4.0.3**.

We are forced to have Spark on the devcontainer docker-compose service because running a Spark driver in client mode requires the driver to have access to Spark binaries, i.e. `/op/spark`. If you want to migrate to local Spark service, use `apache/spark:<SPARK_VERSION>` image for both `spark-master` and `spark-worker`, set the number of executors and their allocated compute resources with `--num-executors`, `--executor-cores` and `--executor-memory`, and set `SPARK_NO_DAEMONIZE=true` to force to keep the invocation of `/opt/spark/sbin/start-master` and `/opt/spark/sbin/start-worker` alive and prevent the container from exiting. Invocation of assembled jars will require submission to an ephemeral container with access to `spark-submit` script.

# Credits
- https://github.com/datablist/sample-csv-files for `./data/customers-100.csv`.
- https://file-examples.com/index.php/sample-images-download/sample-tiff-download/ for `./data/0x00000001-0x00000002-0x00000001.tiff` (downsampled).
- https://people.math.sc.edu/Burkardt/data/tif/tif.html (at3_1m4_01.tif, biological cells, frame 1;) for `./data/0x00000001-0x00000002-0x00000003.tiff` (downsampled).
- https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3 for `./data/Everest_COP30.tif`. **Extent details (lon, lat)**:
    ```
    TL: [86.899444, 28.031667]
    TR: [86.983056, 28.031667]
    BR: [86.983056, 27.957778]
    BL: [86.899444, 27.957778]
    ```
- https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_yellow.pdf for NYC-TLC data dictionary PDF.
- https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/physical/ne_10m_geography_regions_polys.zip for `./data/himalayas.geojson` (extracted with `ogr2ogr himalayas.geojson ne_10m_geography_regions_polys.shp -where "name = 'Himalayas'"`)

// Learn more in: https://www.scala-sbt.org/1.x/docs/sbt-by-example.html

import sbtassembly.AssemblyPlugin.autoImport._

ThisBuild / scalaVersion := "2.13.16"
ThisBuild / version := "0.1.0-SNAPSHOT"

// scala3-migrations warnings as errors hindered the debug-console experience, so I disabled them
// ThisBuild / scalacOptions ++= Seq(
//   "-Wconf:cat=scala3-migration:s"
// )

/* NOTE: Why we shade Spire (and algebra):
 *       I got hit with `java.lang.NoSuchMethodError: 'spire.math.IntIsIntegral spire.math.Integral$.IntIsIntegral()'`
 *       when submitting a geotrellis-spark dependent program to my standalone Spark cluster (Ex07RddProgram)
 *       After numerous debugging sessions, and after analyzing the dependency graph (using `sbt exercises/dependencyDot`),
 *       I (and ChatGPT) figured out that the problem was in a "dependency-race"
 *       between Spark's MLib bundled Spire library (0.18.0) and Geotrellis `sbt-assembly` bundled Spire library (0.17.0).
 *       Because Spark is `% provided` this conflict didn't surface in `sbt evicted`, but only at runtime.
 *       At runtime, Spark would load MLib's Spire (0.18.0) BEFORE the driver had a chance to
 *       load geotrellis-spark and it's Spire (0.17.0) library from the fat-jar.
 * 
 *       One of the ways ChatGPT diagnosed this is by looking at the JARs bundled in the Spark distribution, using this command:
 *       ```
 *       ls -1 $SPARK_HOME/jars | grep -i spire || true
 *       sbt evicted | grep -i spire -n
 *       ```
 *       To get better context into this hellish bug, view the dependency graph dot file interactively
 *       using `sbt exercises/dependencyDot` and the installed `Graphviz Interactive Preview` VSCode extension */
lazy val shadePrefix = "gtshade" // geotrellis shaded package
ThisBuild / assemblyShadeRules := Seq(
  // relocate Spire
  ShadeRule.rename("spire.**" -> s"$shadePrefix.spire.@1").inAll,
  // Spire depends on algebra; relocating it avoids similar collisions
  ShadeRule.rename("algebra.**" -> s"$shadePrefix.algebra.@1").inAll
)
/* WARNING: Technically we got another problem like this between
 *          `scala-collection-compat` 2.2.0 (expected by Geotrellis, packaged in the fat jar)
 *          and Spark provided jar `scala-collection-compat` 2.7.0
 *          Run `ls -1 $SPARK_HOME/jars | grep -i 'scala-collection-compat' || true` to see the conflicting jar file.
 * WARNING: Uncomment if you see any sign of trouble!
 * dependencyOverrides += "org.scala-lang.modules" %% "scala-collection-compat" % "2.7.0" */

lazy val deps = Seq(
  // For Ex02 and beyond
  // For logging, use the same log4j version as apache Spark
  // TODO: validate log4j version
  "org.apache.logging.log4j" % "log4j-api" % "2.20.0",
  "org.apache.logging.log4j" % "log4j-core" % "2.20.0",
  "com.github.tototoshi" %% "scala-csv" % "2.0.0",
  "com.lihaoyi" %% "pprint" % "0.9.6",

  // For Ex05 and Ex07; See: https://github.com/locationtech/geotrellis#getting-started
  "org.locationtech.geotrellis" %% "geotrellis-raster" % "3.8.0",

  // For Ex05_5 and beyond
  // NOTE: "provided" is used to avoid packaging Spark with the application JAR
  //       as it is expected to be available in the Spark runtime environment.
  //       See: https://www.scala-sbt.org/1.x/docs/Scopes.html
  "org.apache.spark" %% "spark-core" % "3.5.5" % "provided",
  "org.apache.spark" %% "spark-sql" % "3.5.5" % "provided",
  // Used to access OS-Lib (os.<*>) and launch sbt processes in Spark exercises
  "org.scala-lang" %% "toolkit" % "0.7.0",

  // For Ex07 basics
  "org.locationtech.geotrellis" %% "geotrellis-layer" % "3.8.0",
  "org.locationtech.geotrellis" %% "geotrellis-spark" % "3.8.0",
  "org.locationtech.geotrellis" %% "geotrellis-vector" % "3.8.0",
  // For Ex07 complex cost analysis
  // `sedona-spark-shaded-3.5` results in a 10MB bigger assembly artifact (173MB->183MB)
  // compared to `sedona-spark-3.5` but results in a more stable fat-jar.
  "org.apache.sedona" %% "sedona-spark-shaded-3.5" % "1.8.1",
  "org.datasyslab" % "geotools-wrapper" % "1.8.1-33.1",
  // For testing Ex07 custom algorithms
  "org.scalatest" %% "scalatest" % "3.2.19" % "test"
)

lazy val exercises = (project in file("apps/exercises"))
  .settings(
    name := "learning-scala",
    // NOTE: Using 2.13.8, we hit eviction issues with GeoTrellis requiring 2.13.16,
    //       but I have to use 2.13.8 because I want Spark 3.5.5 to be rock solid with Almond.
    allowUnsafeScalaLibUpgrade := true,
    Compile / mainClass := Some("learningscala.Main"),
    libraryDependencies ++= deps,

    /* kind-projector is used to handle GeoTrellis source code
     * (`[K: * => SpatialKey, V: * => Tile]`) in ExtendedIterativeCostDistance.scala */
    addCompilerPlugin(
      "org.typelevel" % "kind-projector" % "0.13.3" cross CrossVersion.full
    ),
    // See: https://www.scalatest.org/user_guide/using_scalatest_with_sbt
    Test / logBuffered := false,
    // Parallel testing is off because Spark operates under the assumption of one SparkSession per JVM
    Test / parallelExecution := false,
    // Fork tests so module-opening JVM flags apply to the actual Spark test process.
    Test / fork := true,
    // Include old libraries in import resolution to avoid class-not-found errors
    Test / javaOptions ++= Seq(
      "--add-opens=java.base/java.lang.invoke=ALL-UNNAMED",
      "--add-opens=java.base/java.nio=ALL-UNNAMED",
      "--add-exports=java.base/sun.security.action=ALL-UNNAMED"
    ),
    // Variable `logFileSuffix` is used to have a distinct log-file name for test runs
    // See: `./apps/exercises/src/main/resources/log4j2.properties`
    Test / javaOptions += "-DlogFileSuffix=test",

    // sbt-assembly configuration
    // Name the resulting fat jar predictably: learning-scala-assembly-<version>.jar
    assembly / assemblyJarName := s"${name.value}-assembly-${version.value}.jar",
    // Ensure the assembled jar has the right entrypoint when needed
    assembly / mainClass := Some("learningscala.Main"),
    // Caching (2x performance on cache hits); see: https://github.com/sbt/sbt-assembly?tab=readme-ov-file#jar-assembly-performance
    ThisBuild / assemblyRepeatableBuild := true,
    // Merge strategy to avoid weird conflicts (META-INF, services, HOCON, module-info)
    // See https://github.com/sbt/sbt-assembly?tab=readme-ov-file#merge-strategy
    assembly / assemblyMergeStrategy := {
      case PathList("META-INF", xs @ _*) =>
        xs match {
          case Seq("MANIFEST.MF") | Seq("INDEX.LIST") | Seq("DEPENDENCIES") =>
            MergeStrategy.discard
          case Seq("versions", _ @_*) => MergeStrategy.first
          case Seq("plexus", _ @_*)   => MergeStrategy.discard
          case Seq("services", _ @_*) => MergeStrategy.concat
          case _                      => MergeStrategy.discard
        }
      case "module-info.class"                         => MergeStrategy.discard
      case "reference.conf"                            => MergeStrategy.concat
      case "application.conf"                          => MergeStrategy.concat
      case PathList("META-INF", "native-image", _ @_*) => MergeStrategy.discard
      case PathList("META-INF", "maven", _ @_*)        => MergeStrategy.discard
      case PathList("META-INF", "licenses", _ @_*)     => MergeStrategy.discard
      case "META-INF/NOTICE" | "META-INF/NOTICE.txt"   => MergeStrategy.discard
      case "META-INF/LICENSE" | "META-INF/LICENSE.txt" => MergeStrategy.discard
      // Prefer the first occurrence for everything else
      case _ => MergeStrategy.first
    }
  )

lazy val worksheets = (project in file("worksheets"))
  .settings(
    assembly / skip := true,
    Compile / scalaSource := baseDirectory.value, // Place `worksheet.sc` files under ./worksheets/
    libraryDependencies ++= deps
  )

lazy val root = (project in file("."))
  .aggregate(exercises, worksheets)
  .settings(
    name := "learning-scala-root",
    publish / skip := true,
    assembly / skip := true
  )

# GeoTrellis / Scala devcontainer
# - Spark 3.5.5 + Scala 2.13 (via manual install)
# - Microsoft OpenJDK 17 (latest supported for Spark 3.5.5)
# NOTE: pin Debian Trixie to provide predictable package versions when installing with apt
FROM mcr.microsoft.com/devcontainers/java:17-trixie

# Make all RUN commands use 'set -eux' by default with pipefail for better command pipelines
# NOTE: set -eux
#       -e: exit on error
#       -u: fail on undefined vars
#       -x: print executed commands	
SHELL ["/bin/bash", "-eux", "-o", "pipefail", "-c"]

# Spark binary version
# NOTE: We use Spark 3.5.5 as this is the latest version compatible with GeoTrellis
#       Technically latest supported Spark is 3.5.7:
#       https://github.com/locationtech/geotrellis/blob/7ec19811fa6230faeb531c185d627195ad7b1ec0/project/Dependencies.scala#L65-L67
#       But in Maven it is declared to be dependent on 3.5.5:
#       https://mvnrepository.com/artifact/org.locationtech.geotrellis/geotrellis-spark_2.13/3.8.0
# NOTE: Scala version for Spark 3.5.5 is 2.13.8
ARG SPARK_VERSION=3.5.5
ARG HADOOP_VERSION=3
ARG SCALA_BINARY_VERSION=2.13

# WARNING: Generally, before installing packages, verify they will be compatible with the scala version bundled with Spark
#       VIEW AVAILABLE VERSIONS BY VISITING MVN FOR EACH PACKAGE!
# coursier Scala version
ARG CS_VERSION=2.1.24
ARG SBT_VERSION=1.11.7
ARG SCALA_CLI_VERSION=1.6.1
ARG AMMONITE_VERSION=3.0.4
# NOTE: This warning was resolved by detecting scala version from spark jars at build time, but is still relevant for ALMOND_VERSION
# WARNING: SCAlA VERSION MUST MATCH THE SCALA VERSION OF SPARK!
#          MISMATCHING VERSIONS (EVEN 2.13.17 VS 2.13.8) WILL CAUSE CRYPTIC ERRORS (WHICH CAN TAKE DAYS TO DEBUG!)
#          LIKE `Can only call getServletHandlers on a running MetricsSystem`
#          WHEN CONNECTING TO SPARK FROM THE NOTEBOOK(!),
#          WITH THEM ONLY BEING SURFACED IN `$SPARK_HOME/logs/spark--org.apache.spark.deploy.master.Master-1-spark-localhost.out`
# See scala 2.13.8 compatible almond versions here: https://mvnrepository.com/artifact/sh.almond/scala-kernel_2.13.8
ARG ALMOND_VERSION=0.13.14
ARG SCALAFMT_VERSION=3.10.2

# NOTE: The base image provides the non-root vscode user with UID and GID 1000
ARG USERNAME=vscode

ENV SPARK_HOME=/opt/spark
ENV PATH="/home/vscode/.local/share/coursier/bin:${PATH}"

# Base tools
USER root
# Fetching index, removing it after last apt-get install call
RUN apt-get update

# Install Spark
# NOTE: We chown at the end to avoid weird 1001:1001 ownership popping up
RUN curl -fsSL "https://archive.apache.org/dist/spark/spark-${SPARK_VERSION}/spark-${SPARK_VERSION}-bin-hadoop${HADOOP_VERSION}-scala${SCALA_BINARY_VERSION}.tgz" \
    -o /tmp/spark.tgz \
    && mkdir -p /opt \
    && tar -xzf /tmp/spark.tgz -C /opt \
    && mv "/opt/spark-${SPARK_VERSION}-bin-hadoop${HADOOP_VERSION}-scala${SCALA_BINARY_VERSION}" "${SPARK_HOME}" \
    && rm /tmp/spark.tgz \
    && chown -R ${USERNAME}:${USERNAME} ${SPARK_HOME}

# coursier (Scala artifact fetcher)
RUN curl -fsSL "https://github.com/coursier/coursier/releases/download/v${CS_VERSION}/cs-x86_64-pc-linux.gz" \
    -o /tmp/cs.gz; \
    gunzip /tmp/cs.gz; \
    install -m 0755 /tmp/cs /usr/local/bin/cs; \
    rm -f /tmp/cs

# Derive Scala patch version from Spark distribution
# (AND AVOID MISMATCH BETWEEN INSTALLED SCALA AND SPARK SCALA VERSIONS!)
RUN SCALA_VERSION="$(basename /opt/spark/jars/scala-library-*.jar .jar | cut -d- -f3)"; \
    echo "SCALA_VERSION=$SCALA_VERSION" | tee /etc/spark-scala.env

# Install Scala and dev-tools
# NOTE: We `cs install` and not `cs setup` because we want to be explicit about package versions
USER ${USERNAME}
RUN . /etc/spark-scala.env; \
    mkdir -p ~/.local/share/coursier/bin \
    && cs install "scala:${SCALA_VERSION}" \
    "scalac:${SCALA_VERSION}" \
    "scala-cli:${SCALA_CLI_VERSION}" \
    "sbt:${SBT_VERSION}" \
    "sbtn:${SBT_VERSION}" \
    "ammonite:${AMMONITE_VERSION}" \
    "scalafmt:${SCALAFMT_VERSION}" \
    --install-dir ~/.local/share/coursier/bin
# Install almond kernel
RUN . /etc/spark-scala.env; \
    cs launch --use-bootstrap almond:${ALMOND_VERSION} --scala ${SCALA_VERSION} -- --install

# Install metals for jupyterlab-lsp scala support
RUN cs install metals --install-dir ~/.local/share/coursier/bin

# Install GIS tooling
# GDAL: Verify GeoTrellis results & lightly process raw data after downloading
# osmium: Process OSM specific data format
# NOTE: trixie provide fairly up-to-date GIS packages compared to Ubuntu
USER root
RUN apt-get update && apt-get install -y gdal-bin osmium-tool

# We rely on builtin Python 3.13.5 instead of installing a custom version
USER root
RUN apt-get install -y python3-venv python3-pip pipx

# Install jupyterlab
USER ${USERNAME}
RUN pipx install "jupyterlab>=4.1.0,<5.0.0a0" --include-deps \
    && pipx inject jupyterlab jupyterlab-lsp \
    && pipx inject jupyterlab jupytext \
    && pipx install jupytext \
    && pipx ensurepath

# Additional Utilities
# VSCode extension dependencies (Bash IDE)
USER root
RUN apt-get install -y vim shfmt shellcheck

# Creating dirs before mounting volumes onto them ensures proper permissions (see devcontainer.json `"mounts": {}`)
USER root
RUN mkdir -p /var/spark-events/{eventlog,driverLog} \
    && chown -R ${USERNAME}:${USERNAME} /var/spark-events \
    && mkdir -p /opt/spark/work \
    && chown -R ${USERNAME}:${USERNAME} /opt/spark/work \
    && mkdir -p /home/${USERNAME}/.codex \
    && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.codex

# Install just (https://just.systems/man/en/installation.html)
# Install just-lsp from its pre-built GitHub release (https://github.com/terror/just-lsp/releases)
# Sha256 file hash can be obtained from the same Github release page
RUN curl -fsSL "https://github.com/terror/just-lsp/releases/download/0.5.1/just-lsp-0.5.1-x86_64-unknown-linux-gnu.tar.gz" -o /tmp/just-lsp.tar.gz \
    && echo "2f515fa3df3257f93ced3a675019b95bb7f97b2c1a4ddab6948b6b58f3a678ff  /tmp/just-lsp.tar.gz" | sha256sum --check \
    && tar -xzf /tmp/just-lsp.tar.gz -C /tmp \
    && install -m 0755 /tmp/just-lsp /usr/local/bin/just-lsp \
    && rm -f /tmp/just-lsp /tmp/just-lsp.tar.gz

USER ${USERNAME}

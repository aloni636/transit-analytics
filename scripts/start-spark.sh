# NOTE: Default host is $(hostname), but vscode does not redirect from it to the devcontainer host
#       This is especially important for spark history server and it's executors stdout and stderr raw logs
$SPARK_HOME/sbin/start-master.sh --host localhost  # UI port: 8080
$SPARK_HOME/sbin/start-worker.sh spark://localhost:7077 --host localhost  # UI port: 8081
$SPARK_HOME/sbin/start-history-server.sh  # UI port: 18080
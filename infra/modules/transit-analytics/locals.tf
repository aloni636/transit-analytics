data "aws_caller_identity" "current" {}

locals {
  application_name          = "transit-analytics"
  fetcher_name              = "${local.application_name}-static-fetcher-${var.environment}"
  workflow_executor_name    = "${local.application_name}-sf-workflow-executor-${var.environment}"
  static_feed_workflow_name = "${local.application_name}-static-feed-${var.environment}"
  data_lake_name            = "${local.application_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"

  # This schedule map must stay in sync with the feed keys in static-fetcher/feeds.ts.
  static_feed_schedules = {
    GTFS_SWEDEN_3 = {
      expression = "cron(0 7 * * ? *)"
      timezone   = "Europe/Stockholm"
    }
    GTFS_SVERIGE_2 = {
      expression = "cron(0 7 * * ? *)"
      timezone   = "Europe/Stockholm"
    }
    GTFS_SWITZERLAND = {
      expression = "cron(0 12 ? * MON,THU *)"
      timezone   = "Europe/Zurich"
    }
    GTFS_GERMANY = {
      expression = "cron(0 12 * * ? *)"
      timezone   = "Europe/Berlin"
    }
  }
}

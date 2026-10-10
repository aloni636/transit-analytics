module "transit_analytics" {
  source = "../../modules/transit-analytics"

  environment                 = local.environment
  fetcher_directory           = abspath("${path.root}/../../../transit-analytics/static-fetcher")
  workflow_executor_directory = abspath("${path.root}/../../../transit-analytics/sf-workflow-executor")

  gtfs_sweden_3_static_data         = var.gtfs_sweden_3_static_data
  gtfs_sverige_2                    = var.gtfs_sverige_2
  gtfs_sweden_3_realtime_data       = var.gtfs_sweden_3_realtime_data
  gtfs_sweden_3_service_alerts_data = var.gtfs_sweden_3_service_alerts_data
  gtfs_switzerland_realtime_data    = var.gtfs_switzerland_realtime_data
  trafiklab_secret_version          = var.trafiklab_secret_version
  opentransportdata_secret_version  = var.opentransportdata_secret_version
}

module "transit_analytics" {
  source = "../../modules/transit-analytics"

  environment                 = local.environment
  fetcher_directory           = abspath("${path.root}/../../../transit-analytics/static-fetcher")
  workflow_executor_directory = abspath("${path.root}/../../../transit-analytics/sf-workflow-executor")

  gtfs_sweden_3_static_data = var.gtfs_sweden_3_static_data
  gtfs_sverige_2            = var.gtfs_sverige_2
  trafiklab_secret_version  = var.trafiklab_secret_version
}

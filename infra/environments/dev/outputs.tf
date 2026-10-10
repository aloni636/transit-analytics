output "data_lake_bucket" {
  description = "Transit Analytics dev data-lake bucket."
  value       = module.transit_analytics.data_lake_bucket
}

output "static_fetcher_function_name" {
  description = "Name of the dev static fetcher Lambda."
  value       = module.transit_analytics.static_fetcher_function_name
}

output "workflow_executor_function_name" {
  description = "Name of the dev Step Functions workflow executor Lambda."
  value       = module.transit_analytics.workflow_executor_function_name
}

output "static_feed_workflow_arn" {
  description = "ARN of the dev static-feed Step Functions state machine."
  value       = module.transit_analytics.static_feed_workflow_arn
}

output "trafiklab_secret_arn" {
  description = "ARN of the dev Trafiklab provider secret."
  value       = module.transit_analytics.trafiklab_secret_arn
}

output "realtime_feed_workflow_arn" {
  description = "ARN of the dev realtime-feed collection state machine."
  value       = module.transit_analytics.realtime_feed_workflow_arn
}

output "opentransportdata_secret_arn" {
  description = "ARN of the dev OpenTransportData provider secret."
  value       = module.transit_analytics.opentransportdata_secret_arn
}
output "realtime_fetcher_function_name" {
  value = module.transit_analytics.realtime_fetcher_function_name
}

output "notification_configuration_arn" {
  value = module.transit_analytics.notification_configuration_arn
}

output "notification_test_alarm_name" {
  value = module.transit_analytics.notification_test_alarm_name
}

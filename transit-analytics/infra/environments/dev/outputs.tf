output "data_lake_bucket" {
  description = "Transit Analytics dev data-lake bucket."
  value       = module.transit_analytics.data_lake_bucket
}

output "static_fetcher_function_name" {
  description = "Name of the dev static fetcher Lambda."
  value       = module.transit_analytics.static_fetcher_function_name
}

output "trafiklab_secret_arn" {
  description = "ARN of the dev Trafiklab provider secret."
  value       = module.transit_analytics.trafiklab_secret_arn
}

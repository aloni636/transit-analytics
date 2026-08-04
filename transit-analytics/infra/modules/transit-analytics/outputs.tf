output "data_lake_bucket" {
  description = "Transit Analytics data-lake bucket."
  value       = aws_s3_bucket.data_lake.id
}

output "static_fetcher_function_name" {
  description = "Name used to invoke the static fetcher Lambda."
  value       = aws_lambda_function.static_fetcher.function_name
}

output "trafiklab_secret_arn" {
  description = "Provider-scoped secret read by the static fetcher."
  value       = aws_secretsmanager_secret.provider["trafiklab"].arn
}

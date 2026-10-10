output "data_lake_bucket" {
  description = "Transit Analytics data-lake bucket."
  value       = aws_s3_bucket.data_lake.id
}

output "feed_fetcher_function_name" {
  description = "Name used to invoke the static fetcher Lambda."
  value       = aws_lambda_function.feed_fetcher.function_name
}

output "workflow_executor_function_name" {
  description = "Name of the Lambda that starts scheduled Step Functions workflows."
  value       = aws_lambda_function.workflow_executor.function_name
}

output "static_feed_workflow_arn" {
  description = "ARN of the static-feed Step Functions state machine."
  value       = aws_sfn_state_machine.static_feed.arn
}

output "trafiklab_secret_arn" {
  description = "Provider-scoped secret read by the static fetcher."
  value       = aws_secretsmanager_secret.provider["trafiklab"].arn
}

output "realtime_feed_workflow_arn" {
  description = "ARN of the realtime-feed collection state machine."
  value       = aws_sfn_state_machine.realtime_feed.arn
}

output "opentransportdata_secret_arn" {
  description = "Provider-scoped secret read by the fetcher for Swiss realtime data."
  value       = aws_secretsmanager_secret.provider["opentransportdata"].arn
}
output "realtime_fetcher_function_name" {
  value = aws_lambda_function.realtime_fetcher.function_name
}

output "notification_configuration_arn" {
  value = aws_notifications_notification_configuration.realtime.arn
}

output "notification_test_alarm_name" {
  value = aws_cloudwatch_metric_alarm.notification_test.alarm_name
}

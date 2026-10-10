data "aws_region" "current" {}
data "aws_partition" "current" {}

resource "aws_iam_role" "realtime_fetcher" {
  name               = "${local.realtime_fetcher_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "realtime_fetcher" {
  statement {
    sid       = "WriteRawData"
    actions   = ["s3:AbortMultipartUpload", "s3:PutObject"]
    resources = ["${aws_s3_bucket.data_lake.arn}/raw/*"]
  }

  statement {
    sid       = "ReadProviderCredentials"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for secret in aws_secretsmanager_secret.provider : secret.arn]
  }

  statement {
    sid       = "WriteFunctionLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.realtime_fetcher.arn}:*"]
  }
}

resource "aws_iam_role_policy" "realtime_fetcher" {
  name   = "${local.realtime_fetcher_name}-permissions"
  role   = aws_iam_role.realtime_fetcher.id
  policy = data.aws_iam_policy_document.realtime_fetcher.json
}

resource "aws_cloudwatch_log_group" "realtime_fetcher" {
  name              = "/aws/lambda/${local.realtime_fetcher_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "realtime_fetcher" {
  filename         = data.archive_file.feed_fetcher.output_path
  function_name    = local.realtime_fetcher_name
  role             = aws_iam_role.realtime_fetcher.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.feed_fetcher.output_base64sha256
  runtime          = "nodejs24.x"
  memory_size      = var.lambda_memory_size
  timeout          = 25

  environment {
    variables = aws_lambda_function.feed_fetcher.environment[0].variables
  }

  logging_config {
    application_log_level = "INFO"
    log_format            = "JSON"
    log_group             = aws_cloudwatch_log_group.realtime_fetcher.name
    system_log_level      = "INFO"
  }

  depends_on = [aws_iam_role_policy.realtime_fetcher]
}

resource "aws_cloudwatch_log_metric_filter" "realtime_rate_limit" {
  name           = "${local.realtime_fetcher_name}-rate-limit"
  log_group_name = aws_cloudwatch_log_group.realtime_fetcher.name
  pattern        = "{ $.message.event = \"fetch.rate_limited\" }"

  metric_transformation {
    name          = "RateLimits"
    namespace     = "TransitAnalytics/${var.environment}/Realtime"
    value         = "1"
    default_value = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "realtime" {
  for_each = {
    duration = {
      namespace  = "AWS/Lambda"
      metric     = "Duration"
      statistic  = "Maximum"
      comparison = "GreaterThanThreshold"
      threshold  = 20000
    }
    errors = {
      namespace  = "AWS/Lambda"
      metric     = "Errors"
      statistic  = "Sum"
      comparison = "GreaterThanOrEqualToThreshold"
      threshold  = 1
    }
    rate_limits = {
      namespace  = "TransitAnalytics/${var.environment}/Realtime"
      metric     = "RateLimits"
      statistic  = "Sum"
      comparison = "GreaterThanOrEqualToThreshold"
      threshold  = 1
    }
  }

  alarm_name          = "${local.realtime_fetcher_name}-${each.key}"
  alarm_description   = "Realtime fetcher ${each.key}; inspect Lambda logs and collection execution history."
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  comparison_operator = each.value.comparison
  threshold           = each.value.threshold
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  dimensions          = each.key == "rate_limits" ? {} : { FunctionName = aws_lambda_function.realtime_fetcher.function_name }
}

resource "aws_cloudwatch_metric_alarm" "notification_test" {
  alarm_name          = "${local.realtime_fetcher_name}-notification-test"
  alarm_description   = "Dedicated phone delivery verification alarm; no production workload is invoked."
  namespace           = "TransitAnalytics/${var.environment}/NotificationTest"
  metric_name         = "DeliveryTest"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
}

resource "aws_notifications_notification_hub" "realtime" {
  provider                = aws.notifications
  notification_hub_region = data.aws_region.current.region
}

resource "aws_notifications_notification_configuration" "realtime" {
  provider             = aws.notifications
  name                 = "${local.realtime_fetcher_name}-alerts"
  description          = "GTFS realtime duration, errors, and provider rate limits."
  aggregation_duration = "NONE"
  depends_on           = [aws_notifications_notification_hub.realtime]
}

resource "aws_notifications_event_rule" "realtime" {
  provider                       = aws.notifications
  notification_configuration_arn = aws_notifications_notification_configuration.realtime.arn
  source                         = "aws.cloudwatch"
  event_type                     = "CloudWatch Alarm State Change"
  regions                        = [data.aws_region.current.region]
  event_pattern = jsonencode({
    detail = {
      alarmName = concat([for alarm in aws_cloudwatch_metric_alarm.realtime : alarm.alarm_name], [aws_cloudwatch_metric_alarm.notification_test.alarm_name])
      state     = { value = ["ALARM"] }
    }
  })
}

resource "aws_notifications_channel_association" "mobile" {
  provider                       = aws.notifications
  for_each                       = var.mobile_notification_channel_arns
  arn                            = each.value
  notification_configuration_arn = aws_notifications_notification_configuration.realtime.arn
}

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
  filename         = data.archive_file.static_fetcher.output_path
  function_name    = local.realtime_fetcher_name
  role             = aws_iam_role.realtime_fetcher.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.static_fetcher.output_base64sha256
  runtime          = "nodejs24.x"
  memory_size      = var.lambda_memory_size
  timeout          = 25

  environment {
    variables = aws_lambda_function.static_fetcher.environment[0].variables
  }

  logging_config {
    application_log_level = "INFO"
    log_format            = "JSON"
    log_group             = aws_cloudwatch_log_group.realtime_fetcher.name
    system_log_level      = "INFO"
  }

  depends_on = [aws_iam_role_policy.realtime_fetcher]
}

terraform {
  required_version = ">= 1.11.0"

  # Reusable modules declare minimum (i.e. `>=`) provider versions to allow callers to freely bump provider versions
  # See: https://developer.hashicorp.com/terraform/language/modules/develop/providers#provider-aliases-within-modules
  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.7"
    }
    aws = {
      source                = "hashicorp/aws"
      version               = ">= 6.0"
      configuration_aliases = [aws.notifications]
    }
  }
}

data "archive_file" "static_fetcher" {
  type        = "zip"
  source_dir  = "${var.fetcher_directory}/dist"
  output_path = "${path.root}/.terraform/static-fetcher.zip"
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "static_fetcher" {
  name               = "${local.fetcher_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "static_fetcher" {
  statement {
    sid = "WriteRawData"
    # PutObject authorizes create, upload-part, and complete; Abort permits
    # @aws-sdk/lib-storage to clean up a failed multipart stream.
    actions = [
      "s3:AbortMultipartUpload",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.data_lake.arn}/raw/*"]
  }

  statement {
    sid       = "ReadProviderCredentials"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for secret in aws_secretsmanager_secret.provider : secret.arn]
  }

  statement {
    sid = "WriteFunctionLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.static_fetcher.arn}:*"]
  }
}

resource "aws_iam_role_policy" "static_fetcher" {
  name   = "${local.fetcher_name}-permissions"
  role   = aws_iam_role.static_fetcher.id
  policy = data.aws_iam_policy_document.static_fetcher.json
}

resource "aws_secretsmanager_secret" "provider" {
  for_each = toset(["trafiklab", "opentransportdata"])

  name        = "${local.application_name}/${var.environment}/providers/${each.key}"
  description = "Credentials for the ${each.key} transit data provider."

  tags = {
    Provider = each.key
  }
}

resource "aws_secretsmanager_secret_version" "trafiklab" {
  secret_id = aws_secretsmanager_secret.provider["trafiklab"].id
  secret_string_wo = jsonencode({
    GTFS_SWEDEN_3_STATIC_DATA         = var.gtfs_sweden_3_static_data
    GTFS_SVERIGE_2                    = var.gtfs_sverige_2
    GTFS_SWEDEN_3_REALTIME_DATA       = var.gtfs_sweden_3_realtime_data
    GTFS_SWEDEN_3_SERVICE_ALERTS_DATA = var.gtfs_sweden_3_service_alerts_data
  })
  secret_string_wo_version = var.trafiklab_secret_version
}

resource "aws_secretsmanager_secret_version" "opentransportdata" {
  secret_id = aws_secretsmanager_secret.provider["opentransportdata"].id
  secret_string_wo = jsonencode({
    GTFS_SWITZERLAND_REALTIME_DATA = var.gtfs_switzerland_realtime_data
  })
  secret_string_wo_version = var.opentransportdata_secret_version
}

resource "aws_cloudwatch_log_group" "static_fetcher" {
  name              = "/aws/lambda/${local.fetcher_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "static_fetcher" {
  filename         = data.archive_file.static_fetcher.output_path
  function_name    = local.fetcher_name
  role             = aws_iam_role.static_fetcher.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.static_fetcher.output_base64sha256
  runtime          = "nodejs24.x"
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout

  # Holds GTFS compressed ZIP files because we seek to the end of the file to
  # access ZIP's metastore and deflate; extracted entries stream directly to S3.
  ephemeral_storage {
    size = 1536 # GTFS_SWEDEN_3 ZIP files are around 800MiB, so we double that just to make sure
  }

  environment {
    variables = {
      DESTINATION_BUCKET           = aws_s3_bucket.data_lake.id
      GTFS_USER_AGENT              = "transit-analytics/static-fetcher"
      NODE_OPTIONS                 = "--enable-source-maps" # see `esbuild.mjs`
      TRAFIKLAB_SECRET_ARN         = aws_secretsmanager_secret.provider["trafiklab"].arn
      OPENTRANSPORTDATA_SECRET_ARN = aws_secretsmanager_secret.provider["opentransportdata"].arn
    }
  }

  logging_config {
    application_log_level = "INFO"
    log_format            = "JSON"
    log_group             = aws_cloudwatch_log_group.static_fetcher.name
    system_log_level      = "INFO"
  }

  depends_on = [aws_iam_role_policy.static_fetcher]
}

data "archive_file" "workflow_executor" {
  type        = "zip"
  source_dir  = "${var.workflow_executor_directory}/dist"
  output_path = "${path.root}/.terraform/sf-workflow-executor.zip"
}

resource "aws_iam_role" "workflow_executor" {
  name               = "${local.workflow_executor_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "workflow_executor" {
  statement {
    sid     = "StartFeedWorkflows"
    actions = ["states:StartExecution"]
    resources = [
      aws_sfn_state_machine.static_feed.arn,
    ]
  }

  statement {
    sid = "WriteFunctionLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.workflow_executor.arn}:*"]
  }
}

resource "aws_iam_role_policy" "workflow_executor" {
  name   = "${local.workflow_executor_name}-permissions"
  role   = aws_iam_role.workflow_executor.id
  policy = data.aws_iam_policy_document.workflow_executor.json
}

resource "aws_cloudwatch_log_group" "workflow_executor" {
  name              = "/aws/lambda/${local.workflow_executor_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "workflow_executor" {
  filename         = data.archive_file.workflow_executor.output_path
  function_name    = local.workflow_executor_name
  role             = aws_iam_role.workflow_executor.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.workflow_executor.output_base64sha256
  runtime          = "nodejs24.x"
  memory_size      = 128
  timeout          = 10

  environment {
    variables = {
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  logging_config {
    application_log_level = "INFO"
    log_format            = "JSON"
    log_group             = aws_cloudwatch_log_group.workflow_executor.name
    system_log_level      = "INFO"
  }

  depends_on = [aws_iam_role_policy.workflow_executor]
}

data "aws_iam_policy_document" "step_functions_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "realtime_feed_workflow" {
  name               = "${local.realtime_feed_workflow_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.step_functions_assume_role.json
}

data "aws_iam_policy_document" "realtime_feed_workflow" {
  statement {
    sid       = "InvokeRealtimeFetcher"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.realtime_fetcher.arn]
  }

  statement {
    sid       = "ContinueSameWorkflow"
    actions   = ["states:StartExecution"]
    resources = ["arn:${data.aws_partition.current.partition}:states:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:stateMachine:${local.realtime_feed_workflow_name}"]
  }
}

resource "aws_iam_role_policy" "realtime_feed_workflow" {
  name   = "${local.realtime_feed_workflow_name}-permissions"
  role   = aws_iam_role.realtime_feed_workflow.id
  policy = data.aws_iam_policy_document.realtime_feed_workflow.json
}

resource "aws_sfn_state_machine" "realtime_feed" {
  name     = local.realtime_feed_workflow_name
  role_arn = aws_iam_role.realtime_feed_workflow.arn
  type     = "STANDARD"
  definition = jsonencode(yamldecode(templatefile(
    "${path.module}/realtime-feed-workflow.asl.yaml",
    {
      realtime_fetcher_arn = aws_lambda_function.realtime_fetcher.arn
      realtime_minimums    = jsonencode(jsondecode(file("${var.fetcher_directory}/dist/realtime-feeds.json")))
    },
  )))

  depends_on = [aws_iam_role_policy.realtime_feed_workflow]
}

resource "aws_iam_role" "static_feed_workflow" {
  name               = "${local.static_feed_workflow_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.step_functions_assume_role.json
}

data "aws_iam_policy_document" "static_feed_workflow" {
  statement {
    sid       = "InvokeStaticFetcher"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.static_fetcher.arn]
  }
}

resource "aws_iam_role_policy" "static_feed_workflow" {
  name   = "${local.static_feed_workflow_name}-permissions"
  role   = aws_iam_role.static_feed_workflow.id
  policy = data.aws_iam_policy_document.static_feed_workflow.json
}

resource "aws_sfn_state_machine" "static_feed" {
  name     = local.static_feed_workflow_name
  role_arn = aws_iam_role.static_feed_workflow.arn
  type     = "STANDARD"
  definition = jsonencode(yamldecode(templatefile(
    "${path.module}/static-feed-workflow.asl.yaml",
    { static_fetcher_arn = aws_lambda_function.static_fetcher.arn },
  )))

  # Note that cloudwatch metrics for state machines are automatically
  # published, so for general alerts we don't need to replicate execution
  # logs to cloudwatch with `logging_configuration` block

  # We don't use `publish=true` right now until the pipeline stabilizes
  # and a gradual rollout will start to make sense

  depends_on = [aws_iam_role_policy.static_feed_workflow]
}

data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "static_feed_scheduler" {
  name               = "${local.static_feed_workflow_name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

data "aws_iam_policy_document" "static_feed_scheduler" {
  statement {
    sid       = "InvokeWorkflowExecutor"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.workflow_executor.arn]
  }
}

resource "aws_iam_role_policy" "static_feed_scheduler" {
  name   = "${local.static_feed_workflow_name}-scheduler-permissions"
  role   = aws_iam_role.static_feed_scheduler.id
  policy = data.aws_iam_policy_document.static_feed_scheduler.json
}

resource "aws_scheduler_schedule" "static_feed" {
  for_each = local.static_feed_schedules

  name                         = "${local.application_name}-${lower(each.key)}-${var.environment}"
  state                        = "DISABLED"
  schedule_expression          = each.value.expression
  schedule_expression_timezone = each.value.timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.workflow_executor.arn
    role_arn = aws_iam_role.static_feed_scheduler.arn

    # https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html
    input = jsonencode({
      feedKey         = each.key
      scheduleArn     = "<aws.scheduler.schedule-arn>"
      scheduledTime   = "<aws.scheduler.scheduled-time>"
      stateMachineArn = aws_sfn_state_machine.static_feed.arn
    })
  }

  depends_on = [aws_iam_role_policy.static_feed_scheduler]
}

data "aws_caller_identity" "current" {}

locals {
  application_name = "transit-analytics"
  fetcher_name     = "${local.application_name}-static-fetcher-${var.environment}"
  data_lake_name   = "${local.application_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

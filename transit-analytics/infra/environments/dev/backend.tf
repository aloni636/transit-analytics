terraform {
  required_version = ">= 1.11.0"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    # The bucket and state region come from the ignored infra/state.config file.
    # https://developer.hashicorp.com/terraform/language/backend#partial-configuration
    key          = "transit-analytics/dev/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

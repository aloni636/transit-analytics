locals {
  environment = "dev"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "Learning-Scala"
      Application = "Transit-Analytics"
      Environment = local.environment
      ManagedBy   = "Terraform"
    }
  }
}

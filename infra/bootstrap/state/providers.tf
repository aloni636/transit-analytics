terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "Learning-Scala"
      Application = "Transit-Analytics"
      ManagedBy   = "Terraform"
      Purpose     = "Terraform-State"
    }
  }
}

variable "bucket" {
  description = "Name of the S3 bucket that stores Terraform state."
  type        = string
}

variable "region" {
  description = "AWS region containing the Terraform state bucket."
  type        = string
}

output "state_bucket" {
  description = "S3 bucket containing Transit Analytics Terraform state."
  value       = aws_s3_bucket.terraform_state.id
}

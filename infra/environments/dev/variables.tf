variable "aws_region" {
  description = "AWS region where Transit Analytics application resources are deployed."
  type        = string
}

variable "gtfs_sweden_3_static_data" {
  description = "Trafiklab API key for GTFS Sweden 3."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "gtfs_sverige_2" {
  description = "Trafiklab API key for GTFS Sverige 2."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "trafiklab_secret_version" {
  description = "Increment when the dev Trafiklab credential is rotated."
  type        = number

  validation {
    condition     = var.trafiklab_secret_version >= 1
    error_message = "trafiklab_secret_version must be at least 1."
  }
}

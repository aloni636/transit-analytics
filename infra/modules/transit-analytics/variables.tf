variable "environment" {
  description = "Deployment environment included in resource names and tags."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "fetcher_directory" {
  description = "Absolute path to the static fetcher package."
  type        = string
}

variable "workflow_executor_directory" {
  description = "Absolute path to the Step Functions workflow executor package."
  type        = string
}

variable "lambda_memory_size" {
  description = "Static fetcher Lambda memory in MiB."
  type        = number
  default     = 512

  validation {
    condition     = var.lambda_memory_size >= 128 && var.lambda_memory_size <= 10240
    error_message = "lambda_memory_size must be between 128 and 10240 MiB."
  }
}

variable "lambda_timeout" {
  description = "Static fetcher Lambda timeout in seconds."
  type        = number
  default     = 900

  validation {
    condition     = var.lambda_timeout >= 1 && var.lambda_timeout <= 900
    error_message = "lambda_timeout must be between 1 and 900 seconds."
  }
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

variable "gtfs_sweden_3_realtime_data" {
  description = "Trafiklab API key for Swedish GTFS Realtime TripUpdates."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "gtfs_sweden_3_service_alerts_data" {
  description = "Trafiklab API key for Swedish GTFS Realtime ServiceAlerts."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "gtfs_switzerland_realtime_data" {
  description = "OpenTransportData API bearer credential for Swiss GTFS Realtime."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "trafiklab_secret_version" {
  description = "Increment when the Trafiklab credential is rotated."
  type        = number

  validation {
    condition     = var.trafiklab_secret_version >= 1
    error_message = "trafiklab_secret_version must be at least 1."
  }
}

variable "opentransportdata_secret_version" {
  description = "Increment when the OpenTransportData credential is rotated."
  type        = number

  validation {
    condition     = var.opentransportdata_secret_version >= 1
    error_message = "opentransportdata_secret_version must be at least 1."
  }
}

variable "mobile_notification_channel_arns" {
  description = "Registered AWS Console Mobile device channel ARNs to receive realtime alarms."
  type        = set(string)
  default     = []
}

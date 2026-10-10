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
  description = "Increment when the dev Trafiklab credential is rotated."
  type        = number

  validation {
    condition     = var.trafiklab_secret_version >= 1
    error_message = "trafiklab_secret_version must be at least 1."
  }
}

variable "opentransportdata_secret_version" {
  description = "Increment when the dev OpenTransportData credential is rotated."
  type        = number

  validation {
    condition     = var.opentransportdata_secret_version >= 1
    error_message = "opentransportdata_secret_version must be at least 1."
  }
}

variable "mobile_notification_channel_arns" {
  description = "Registered AWS Console Mobile device channels for realtime collection alarms."
  type        = set(string)
  default     = []
}

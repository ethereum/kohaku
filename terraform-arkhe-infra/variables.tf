variable "extenddb_enabled" {
  description = "Enable ExtendDB infrastructure"
  type        = bool
  default     = true
}

variable "extenddb_postgres_instance_class" {
  description = "PostgreSQL instance class for ExtendDB"
  default = {
    aws   = "db.t4g.large"
    gcp   = "db-custom-2-8192"
    azure = "GP_Standard_D2s_v3"
  }
}

variable "extenddb_postgres_storage_gb" {
  description = "Storage size for ExtendDB PostgreSQL (GB)"
  type        = number
  default     = 100
}

variable "helm_namespace" {
  description = "Kubernetes namespace for helm deployment"
  type        = string
  default     = "arkhe"
}

variable "gcp_region" {
  description = "Region for GCP resources"
  type        = string
  default     = "us-central1"
}

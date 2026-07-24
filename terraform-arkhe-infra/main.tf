variable "arkhe_version" {
  type    = string
  default = "v1.0.0"
}
variable "arkhe_seal" {
  type    = string
  default = "e6c32a920cf0aca67b58950d2e04a03492b6b99ff9f22d2a3018f9490dcf4a9f"
}
variable "substrates" {
  type    = list(string)
  default = ["585", "586", "587", "566", "570", "597a", "597b", "597c"]
}
variable "environment" {
  type = string
}
variable "cloud_provider" {
  type = string
}
variable "region" {
  type = string
}
variable "cluster_name" {
  type = string
}
variable "node_instance_type" {
  type = string
}
variable "gpu_instance_type" {
  type = string
}
variable "enable_gpu" {
  type = bool
}
variable "min_nodes" {
  type = number
}
variable "max_nodes" {
  type = number
}

variable "extenddb_enabled" {
  description = "Enable ExtendDB infrastructure"
  type        = bool
  default     = true
}

variable "extenddb_postgres_instance_class" {
  description = "PostgreSQL instance class for ExtendDB"
  type        = string
}

variable "extenddb_postgres_storage_gb" {
  description = "Storage size for ExtendDB PostgreSQL (GB)"
  type        = number
  default     = 100
}

module "aws_infrastructure" {
  source = "./modules/aws"
  count  = var.cloud_provider == "aws" ? 1 : 0

  environment                      = var.environment
  region                           = var.region
  cluster_name                     = var.cluster_name
  node_instance_type               = var.node_instance_type
  gpu_instance_type                = var.gpu_instance_type
  enable_gpu                       = var.enable_gpu
  min_nodes                        = var.min_nodes
  max_nodes                        = var.max_nodes
  extenddb_enabled                 = var.extenddb_enabled
  extenddb_postgres_instance_class = var.extenddb_postgres_instance_class
  extenddb_postgres_storage_gb     = var.extenddb_postgres_storage_gb
}

module "gcp_infrastructure" {
  source = "./modules/gcp"
  count  = var.cloud_provider == "gcp" ? 1 : 0

  environment                      = var.environment
  region                           = var.region
  cluster_name                     = var.cluster_name
  node_instance_type               = var.node_instance_type
  gpu_instance_type                = var.gpu_instance_type
  enable_gpu                       = var.enable_gpu
  min_nodes                        = var.min_nodes
  max_nodes                        = var.max_nodes
  extenddb_enabled                 = var.extenddb_enabled
  extenddb_postgres_instance_class = var.extenddb_postgres_instance_class
  extenddb_postgres_storage_gb     = var.extenddb_postgres_storage_gb
}

module "azure_infrastructure" {
  source = "./modules/azure"
  count  = var.cloud_provider == "azure" ? 1 : 0

  environment                      = var.environment
  region                           = var.region
  cluster_name                     = var.cluster_name
  node_instance_type               = var.node_instance_type
  gpu_instance_type                = var.gpu_instance_type
  enable_gpu                       = var.enable_gpu
  min_nodes                        = var.min_nodes
  max_nodes                        = var.max_nodes
  extenddb_enabled                 = var.extenddb_enabled
  extenddb_postgres_instance_class = var.extenddb_postgres_instance_class
  extenddb_postgres_storage_gb     = var.extenddb_postgres_storage_gb
}

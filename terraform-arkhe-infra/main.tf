terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "arkhe-terraform-state"
    key            = "unified/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "arkhe-terraform-locks"
  }
}

variable "arkhe_version" {
  description = "ARKHE OS version"
  type        = string
  default     = "v∞.Ω.∇+++"
}

variable "arkhe_seal" {
  description = "Unified container seal"
  type        = string
  default     = "e6c32a920cf0aca67b58950d2e04a03492b6b99ff9f22d2a3018f9490dcf4a9f"
}

variable "substrates" {
  description = "List of substrates to deploy"
  type        = list(string)
  default     = ["585", "586", "587", "566", "570", "597A", "597B", "597C"]
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "cloud_provider" {
  description = "Cloud provider"
  type        = string
  validation {
    condition     = contains(["aws", "gcp", "azure"], var.cloud_provider)
    error_message = "Cloud provider must be aws, gcp, or azure."
  }
}

variable "region" {
  description = "Cloud region"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "Kubernetes cluster name"
  type        = string
  default     = "arkhe-unified"
}

variable "node_instance_type" {
  description = "Instance type for worker nodes"
  type        = string
  default     = "m6i.2xlarge"
}

variable "gpu_instance_type" {
  description = "GPU instance type for substrate 586"
  type        = string
  default     = "g5.2xlarge"
}

variable "enable_gpu" {
  description = "Enable GPU nodes for Synapse Brain Map"
  type        = bool
  default     = true
}

variable "min_nodes" {
  description = "Minimum number of nodes"
  type        = number
  default     = 3
}

variable "max_nodes" {
  description = "Maximum number of nodes"
  type        = number
  default     = 20
}

locals {
  common_tags = {
    ArkheVersion   = var.arkhe_version
    ArkheSeal      = var.arkhe_seal
    ArkheSubstrates = join(",", var.substrates)
    Environment    = var.environment
    ManagedBy      = "terraform"
    Architect      = "ORCID:0009-0005-2697-4668"
  }

  substrate_configs = {
    "585" = { name = "groth16-zksecurity", cpu = "2000m", memory = "4Gi", replicas = 3 }
    "586" = { name = "synapse-brain-map",  cpu = "8000m", memory = "32Gi", replicas = 2, gpu = true }
    "587" = { name = "podman-runtime",     cpu = "2000m", memory = "4Gi", replicas = 2 }
    "566" = { name = "container-runtime",  cpu = "1000m", memory = "2Gi", replicas = 2 }
    "570" = { name = "claude-code-bridge", cpu = "4000m", memory = "16Gi", replicas = 1 }
    "597A" = { name = "openbiollm", cpu = "4000m", memory = "16Gi", replicas = 1 }
    "597B" = { name = "biollm-bgi", cpu = "8000m", memory = "32Gi", replicas = 1, gpu = true }
    "597C" = { name = "biollm-wetware", cpu = "2000m", memory = "4Gi", replicas = 1 }
  }
}

module "aws_infrastructure" {
  source = "./modules/aws"
  count  = var.cloud_provider == "aws" ? 1 : 0

  environment        = var.environment
  region             = var.region
  cluster_name       = var.cluster_name
  node_instance_type = var.node_instance_type
  gpu_instance_type  = var.gpu_instance_type
  enable_gpu         = var.enable_gpu
  min_nodes          = var.min_nodes
  max_nodes          = var.max_nodes
  common_tags        = local.common_tags
  substrate_configs  = local.substrate_configs
}

module "gcp_infrastructure" {
  source = "./modules/gcp"
  count  = var.cloud_provider == "gcp" ? 1 : 0

  environment        = var.environment
  region             = var.region
  cluster_name       = var.cluster_name
  node_instance_type = var.node_instance_type
  gpu_instance_type  = var.gpu_instance_type
  enable_gpu         = var.enable_gpu
  min_nodes          = var.min_nodes
  max_nodes          = var.max_nodes
  common_tags        = local.common_tags
  substrate_configs  = local.substrate_configs
}

module "azure_infrastructure" {
  source = "./modules/azure"
  count  = var.cloud_provider == "azure" ? 1 : 0

  environment        = var.environment
  region             = var.region
  cluster_name       = var.cluster_name
  node_instance_type = var.node_instance_type
  gpu_instance_type  = var.gpu_instance_type
  enable_gpu         = var.enable_gpu
  min_nodes          = var.min_nodes
  max_nodes          = var.max_nodes
  common_tags        = local.common_tags
  substrate_configs  = local.substrate_configs
}

output "cluster_endpoint" {
  value       = var.cloud_provider == "aws" ? module.aws_infrastructure[0].cluster_endpoint : var.cloud_provider == "gcp" ? module.gcp_infrastructure[0].cluster_endpoint : module.azure_infrastructure[0].cluster_endpoint
}

output "kubeconfig_command" {
  value       = var.cloud_provider == "aws" ? module.aws_infrastructure[0].kubeconfig_command : var.cloud_provider == "gcp" ? module.gcp_infrastructure[0].kubeconfig_command : module.azure_infrastructure[0].kubeconfig_command
}

output "gateway_url" {
  value       = var.cloud_provider == "aws" ? module.aws_infrastructure[0].gateway_url : var.cloud_provider == "gcp" ? module.gcp_infrastructure[0].gateway_url : module.azure_infrastructure[0].gateway_url
}

output "substrate_endpoints" {
  value       = var.cloud_provider == "aws" ? module.aws_infrastructure[0].substrate_endpoints : var.cloud_provider == "gcp" ? module.gcp_infrastructure[0].substrate_endpoints : module.azure_infrastructure[0].substrate_endpoints
}

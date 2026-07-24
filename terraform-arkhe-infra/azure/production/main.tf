# ═══════════════════════════════════════════════════════════════════════════════
# Azure Production Environment
# ═══════════════════════════════════════════════════════════════════════════════

terraform {
  backend "azurerm" {
    resource_group_name  = "arkhe-terraform-rg"
    storage_account_name = "arkhetfstate"
    container_name       = "tfstate"
    key                  = "azure/production/terraform.tfstate"
  }
}

module "arkhe_azure_prod" {
  source = "../../"

  environment        = "production"
  cloud_provider     = "azure"
  region             = "East US"
  cluster_name       = "arkhe-production"
  node_instance_type = "Standard_D16s_v5"
  gpu_instance_type  = "Standard_NC6s_v3"
  enable_gpu         = true
  min_nodes          = 5
  max_nodes          = 50
}

output "cluster_endpoint" {
  value = module.arkhe_azure_prod.cluster_endpoint
}

output "kubeconfig" {
  value = module.arkhe_azure_prod.kubeconfig_command
}

output "gateway" {
  value = module.arkhe_azure_prod.gateway_url
}
# ═══════════════════════════════════════════════════════════════════════════════
# GCP Production Environment
# ═══════════════════════════════════════════════════════════════════════════════

terraform {
  backend "gcs" {
    bucket = "arkhe-terraform-state"
    prefix = "gcp/production"
  }
}

module "arkhe_gcp_prod" {
  source = "../../"

  environment        = "production"
  cloud_provider     = "gcp"
  region             = "us-central1"
  cluster_name       = "arkhe-production"
  node_instance_type = "n2-standard-16"
  gpu_instance_type  = "n1-standard-8"
  enable_gpu         = true
  min_nodes          = 5
  max_nodes          = 50
}

output "cluster_endpoint" {
  value = module.arkhe_gcp_prod.cluster_endpoint
}

output "kubeconfig" {
  value = module.arkhe_gcp_prod.kubeconfig_command
}

output "gateway" {
  value = module.arkhe_gcp_prod.gateway_url
}
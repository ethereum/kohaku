# ═══════════════════════════════════════════════════════════════════════════════
# AWS Production Environment
# ═══════════════════════════════════════════════════════════════════════════════

terraform {
  backend "s3" {
    bucket         = "arkhe-terraform-state"
    key            = "aws/production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "arkhe-terraform-locks"
  }
}

module "arkhe_aws_prod" {
  source = "../../"

  environment        = "production"
  cloud_provider     = "aws"
  region             = "us-east-1"
  cluster_name       = "arkhe-production"
  node_instance_type = "m6i.4xlarge"
  gpu_instance_type  = "g5.4xlarge"
  enable_gpu         = true
  min_nodes          = 5
  max_nodes          = 50
}

output "cluster_endpoint" {
  value = module.arkhe_aws_prod.cluster_endpoint
}

output "kubeconfig" {
  value = module.arkhe_aws_prod.kubeconfig_command
}

output "gateway" {
  value = module.arkhe_aws_prod.gateway_url
}
variable "environment" { type = string }
variable "region" { type = string }
variable "cluster_name" { type = string }
variable "node_instance_type" { type = string }
variable "gpu_instance_type" { type = string }
variable "enable_gpu" { type = bool }
variable "min_nodes" { type = number }
variable "max_nodes" { type = number }
variable "common_tags" { type = map(string) }
variable "substrate_configs" { type = map(any) }

data "aws_availability_zones" "available" {
  state = "available"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = "10.0.0.0/16"

  azs             = slice(data.aws_availability_zones.available.names, 0, 3)
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = var.environment == "dev"
  enable_dns_hostnames = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = "1.30"

  cluster_endpoint_public_access = true
  cluster_endpoint_private_access = var.environment == "production"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = merge({
    general = {
      desired_size = var.min_nodes
      min_size     = var.min_nodes
      max_size     = var.max_nodes

      instance_types = [var.node_instance_type]
      capacity_type  = var.environment == "production" ? "ON_DEMAND" : "SPOT"

      labels = {
        workload = "general"
        "arkhe.substrate" = "all"
      }

      taints = []
    }
  },
  var.enable_gpu ? {
    gpu = {
      desired_size = 1
      min_size     = 0
      max_size     = 5

      instance_types = [var.gpu_instance_type]
      ami_type       = "AL2_x86_64_GPU"
      capacity_type  = "ON_DEMAND"

      labels = {
        workload = "gpu"
        "arkhe.substrate" = "586"
        "nvidia.com/gpu.present" = "true"
      }

      taints = [{
        key    = "nvidia.com/gpu"
        value  = "true"
        effect = "NO_SCHEDULE"
      }]
    }
  } : {})

  tags = var.common_tags
}

module "alb_ingress_controller" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "${var.cluster_name}-alb-ingress"

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

module "ebs_csi_driver" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "${var.cluster_name}-ebs-csi"

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "kubeconfig_command" {
  value = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}"
}

output "gateway_url" {
  value = "https://arkhe.${var.environment}.arkhe-os.org"
}

output "substrate_endpoints" {
  value = {
    for id, cfg in var.substrate_configs : id => {
      name = cfg.name
      url  = "http://${cfg.name}.${var.cluster_name}.svc.cluster.local"
    }
  }
}

output "vpc_id" {
  value = module.vpc.vpc_id
}
output "private_subnets" {
  value = module.vpc.private_subnets
}
output "node_security_group_id" {
  value = module.eks.node_security_group_id
}

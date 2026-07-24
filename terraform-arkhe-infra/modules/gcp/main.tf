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

resource "google_compute_network" "vpc" {
  name                    = "${var.cluster_name}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${var.cluster_name}-subnet"
  ip_cidr_range = "10.0.0.0/16"
  region        = var.region
  network       = google_compute_network.vpc.id

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.1.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.2.0.0/16"
  }
}

resource "google_container_cluster" "arkhe" {
  name     = var.cluster_name
  location = var.region

  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  release_channel {
    channel = "REGULAR"
  }

  node_pool {
    name       = "general-pool"
    node_count = var.min_nodes

    node_config {
      machine_type = var.node_instance_type
      oauth_scopes = [
        "https://www.googleapis.com/auth/cloud-platform"
      ]
      labels = {
        workload = "general"
        "arkhe.substrate" = "all"
      }
      tags = ["arkhe-${var.environment}"]
    }

    autoscaling {
      min_node_count = var.min_nodes
      max_node_count = var.max_nodes
    }
  }

  dynamic "node_pool" {
    for_each = var.enable_gpu ? [1] : []
    content {
      name       = "gpu-pool"
      node_count = 1

      node_config {
        machine_type = var.gpu_instance_type
        guest_accelerator {
          type  = "nvidia-tesla-t4"
          count = 1
          gpu_sharing_config {
            gpu_sharing_strategy = "TIME_SHARING"
            max_shared_clients_per_gpu = 2
          }
        }
        oauth_scopes = [
          "https://www.googleapis.com/auth/cloud-platform"
        ]
        labels = {
          workload = "gpu"
          "arkhe.substrate" = "586"
          "nvidia.com/gpu.present" = "true"
        }
        taint {
          key    = "nvidia.com/gpu"
          value  = "true"
          effect = "NO_SCHEDULE"
        }
      }

      autoscaling {
        min_node_count = 0
        max_node_count = 5
      }
    }
  }

  resource_labels = var.common_tags
}

resource "google_compute_global_address" "arkhe_ip" {
  name = "${var.cluster_name}-ip"
}

output "cluster_endpoint" {
  value = "https://${google_container_cluster.arkhe.endpoint}"
}

output "cluster_name" {
  value = google_container_cluster.arkhe.name
}

output "kubeconfig_command" {
  value = "gcloud container clusters get-credentials ${google_container_cluster.arkhe.name} --region ${var.region}"
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
  value = google_compute_network.vpc.id
}

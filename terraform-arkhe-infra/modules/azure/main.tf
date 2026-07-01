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

resource "azurerm_resource_group" "arkhe" {
  name     = "rg-${var.cluster_name}-${var.environment}"
  location = var.region
  tags     = var.common_tags
}

resource "azurerm_virtual_network" "vnet" {
  name                = "${var.cluster_name}-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.arkhe.location
  resource_group_name = azurerm_resource_group.arkhe.name
}

resource "azurerm_subnet" "subnet" {
  name                 = "${var.cluster_name}-subnet"
  resource_group_name  = azurerm_resource_group.arkhe.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_kubernetes_cluster" "arkhe" {
  name                = var.cluster_name
  location            = azurerm_resource_group.arkhe.location
  resource_group_name = azurerm_resource_group.arkhe.name
  dns_prefix          = var.cluster_name
  kubernetes_version  = "1.30"

  default_node_pool {
    name                = "general"
    node_count          = var.min_nodes
    vm_size             = var.node_instance_type
    vnet_subnet_id      = azurerm_subnet.subnet.id
    min_count           = var.min_nodes
    max_count           = var.max_nodes
    enable_auto_scaling = true

    node_labels = {
      workload = "general"
      "arkhe.substrate" = "all"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin    = "azure"
    load_balancer_sku = "standard"
  }

  tags = var.common_tags
}

resource "azurerm_kubernetes_cluster_node_pool" "gpu" {
  count = var.enable_gpu ? 1 : 0

  name                  = "gpu"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.arkhe.id
  vm_size               = var.gpu_instance_type
  node_count            = 1
  min_count             = 0
  max_count             = 5
  enable_auto_scaling   = true
  vnet_subnet_id        = azurerm_subnet.subnet.id

  node_labels = {
    workload = "gpu"
    "arkhe.substrate" = "586"
    "nvidia.com/gpu.present" = "true"
  }

  node_taints = ["nvidia.com/gpu=true:NoSchedule"]
}

resource "azurerm_public_ip" "arkhe" {
  name                = "${var.cluster_name}-pip"
  resource_group_name = azurerm_resource_group.arkhe.name
  location            = azurerm_resource_group.arkhe.location
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_private_dns_zone" "postgres" {
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.arkhe.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "postgres-dns-link"
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.vnet.id
  resource_group_name   = azurerm_resource_group.arkhe.name
}

output "cluster_endpoint" {
  value = azurerm_kubernetes_cluster.arkhe.kube_config.0.host
}

output "cluster_name" {
  value = azurerm_kubernetes_cluster.arkhe.name
}

output "kubeconfig_command" {
  value = "az aks get-credentials --name ${azurerm_kubernetes_cluster.arkhe.name} --resource-group ${azurerm_resource_group.arkhe.name}"
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

output "resource_group_name" {
  value = azurerm_resource_group.arkhe.name
}
output "location" {
  value = azurerm_resource_group.arkhe.location
}
output "aks_subnet_id" {
  value = azurerm_subnet.subnet.id
}
output "postgres_dns_zone_id" {
  value = azurerm_private_dns_zone.postgres.id
}
output "postgres_dns_link" {
  value = azurerm_private_dns_zone_virtual_network_link.postgres.id
}

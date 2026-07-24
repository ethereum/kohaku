# Azure PostgreSQL Flexible Server para ExtendDB
resource "azurerm_postgresql_flexible_server" "extenddb" {
  count               = var.extenddb_enabled ? 1 : 0
  name                = "${var.cluster_name}-extenddb"
  resource_group_name = azurerm_resource_group.arkhe.name
  location            = azurerm_resource_group.arkhe.location
  version             = "16"

  administrator_login    = "arkhe_extenddb"
  administrator_password = random_password.extenddb_postgres[0].result

  storage_mb   = var.extenddb_postgres_storage_gb * 1024
  storage_tier = "P30"
  sku_name     = var.extenddb_postgres_instance_class

  backup_retention_days = var.environment == "production" ? 35 : 7

  delegated_subnet_id = azurerm_subnet.subnet.id
  # private_dns_zone_id is assumed to be configured within the vnet
}

resource "azurerm_postgresql_flexible_server_database" "extenddb" {
  count     = var.extenddb_enabled ? 1 : 0
  name      = "extenddb_catalog"
  server_id = azurerm_postgresql_flexible_server.extenddb[0].id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "random_password" "extenddb_postgres" {
  count   = var.extenddb_enabled ? 1 : 0
  length  = 32
  special = false
}

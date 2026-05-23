output "extenddb_endpoint" {
  description = "ExtendDB PostgreSQL endpoint"
  value       = var.extenddb_enabled ? azurerm_postgresql_flexible_server.extenddb[0].fqdn : null
}

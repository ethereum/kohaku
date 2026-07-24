output "extenddb_endpoint" {
  description = "ExtendDB PostgreSQL endpoint"
  value       = var.extenddb_enabled ? google_sql_database_instance.extenddb_postgres[0].private_ip_address : null
}

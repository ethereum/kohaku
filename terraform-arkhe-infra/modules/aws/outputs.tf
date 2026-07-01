output "extenddb_endpoint" {
  description = "ExtendDB PostgreSQL endpoint"
  value       = var.extenddb_enabled ? aws_db_instance.extenddb_postgres[0].address : null
}

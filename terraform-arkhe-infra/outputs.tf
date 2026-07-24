output "extenddb_endpoint" {
  description = "ExtendDB PostgreSQL endpoint"
  value       = var.cloud_provider == "aws" ? module.aws_infrastructure[0].extenddb_endpoint : var.cloud_provider == "gcp" ? module.gcp_infrastructure[0].extenddb_endpoint : module.azure_infrastructure[0].extenddb_endpoint
}
output "extenddb_database_name" {
  description = "ExtendDB Database Name"
  value       = "extenddb_catalog"
}

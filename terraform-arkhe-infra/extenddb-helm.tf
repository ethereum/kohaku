resource "helm_release" "extenddb" {
  count      = var.extenddb_enabled ? 1 : 0
  name       = "extenddb"
  namespace  = var.helm_namespace
  chart      = "${path.module}/charts/extenddb"   # chart customizado ou OCI

  values = [yamlencode({
    storage = {
      postgres = {
        host     = var.cloud_provider == "aws" ? aws_db_instance.extenddb_postgres[0].address : (var.cloud_provider == "gcp" ? google_sql_database_instance.extenddb_postgres[0].private_ip_address : azurerm_postgresql_flexible_server.extenddb[0].fqdn)
        port     = 5432
        user     = local.extenddb_postgres_user
        dbname   = local.extenddb_postgres_db_name
        existingSecret = "extenddb-postgres-credentials"
      }
    }
    resources = {
      requests = { cpu = "500m", memory = "1Gi" }
      limits   = { cpu = "2000m", memory = "4Gi" }
    }
    service = {
      type = "ClusterIP"
      port = 8000
    }
    ingress = {
      enabled = true
      hosts   = ["extenddb.${var.cluster_name}.internal"]
    }
    monitoring = {
      enabled       = true
      serviceMonitor = { enabled = true }
    }
  })]

  depends_on = [kubernetes_secret.extenddb_postgres]
}
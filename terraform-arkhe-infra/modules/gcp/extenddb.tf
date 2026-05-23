# GCP Cloud SQL PostgreSQL para ExtendDB
resource "google_sql_database_instance" "extenddb_postgres" {
  count            = var.extenddb_enabled ? 1 : 0
  name             = "${var.cluster_name}-extenddb"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.extenddb_postgres_instance_class
    disk_size         = var.extenddb_postgres_storage_gb
    disk_type         = "PD_SSD"
    availability_type = var.environment == "production" ? "REGIONAL" : "ZONAL"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = var.environment == "production"
      start_time                     = "03:00"
    }

    ip_configuration {
      ipv4_enabled = false
      private_network = google_compute_network.vpc.id
    }
  }

  deletion_protection = var.environment == "production"
}

resource "google_sql_database" "extenddb" {
  count    = var.extenddb_enabled ? 1 : 0
  name     = "extenddb_catalog"
  instance = google_sql_database_instance.extenddb_postgres[0].name
}

resource "google_sql_user" "extenddb" {
  count    = var.extenddb_enabled ? 1 : 0
  name     = "arkhe_extenddb"
  instance = google_sql_database_instance.extenddb_postgres[0].name
  password = random_password.extenddb_postgres[0].result
}

resource "random_password" "extenddb_postgres" {
  count   = var.extenddb_enabled ? 1 : 0
  length  = 32
  special = false
}

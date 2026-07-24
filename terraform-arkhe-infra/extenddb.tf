locals {
  extenddb_postgres_db_name = "extenddb_catalog"
  extenddb_postgres_user    = "arkhe_extenddb"
}

resource "aws_db_instance" "extenddb_postgres" {
  count = var.cloud_provider == "aws" && var.extenddb_enabled ? 1 : 0

  identifier     = "${var.cluster_name}-extenddb"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.extenddb_postgres_instance_class[var.cloud_provider]

  db_name  = local.extenddb_postgres_db_name
  username = local.extenddb_postgres_user
  password = random_password.extenddb_postgres[0].result

  allocated_storage     = var.extenddb_postgres_storage_gb
  storage_encrypted     = true
  storage_type          = "gp3"
  multi_az              = var.environment == "production"
  publicly_accessible   = false
  vpc_security_group_ids = [aws_security_group.extenddb_postgres[0].id]
  db_subnet_group_name  = aws_db_subnet_group.extenddb[0].name

  backup_retention_period = var.environment == "production" ? 30 : 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  deletion_protection     = var.environment == "production"

  tags = {
    Name    = "${var.cluster_name}-extenddb"
    Arkhe   = "true"
    Service = "extenddb"
  }
}

resource "random_password" "extenddb_postgres" {
  count   = var.extenddb_enabled ? 1 : 0
  length  = 32
  special = false
}

resource "aws_security_group" "extenddb_postgres" {
  count       = var.cloud_provider == "aws" && var.extenddb_enabled ? 1 : 0
  name        = "${var.cluster_name}-extenddb-postgres"
  description = "Security group for ExtendDB PostgreSQL"
  vpc_id      = module.aws_infrastructure[0].vpc_id

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.aws_infrastructure[0].node_security_group_id]
  }
}

resource "aws_db_subnet_group" "extenddb" {
  count      = var.cloud_provider == "aws" && var.extenddb_enabled ? 1 : 0
  name       = "${var.cluster_name}-extenddb"
  subnet_ids = module.aws_infrastructure[0].private_subnets
}

resource "google_sql_database_instance" "extenddb_postgres" {
  count            = var.cloud_provider == "gcp" && var.extenddb_enabled ? 1 : 0
  name             = "${var.cluster_name}-extenddb"
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  settings {
    tier              = var.extenddb_postgres_instance_class[var.cloud_provider]
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
      private_network = module.gcp_infrastructure[0].vpc_id
    }
  }

  deletion_protection = var.environment == "production"
}

resource "google_sql_database" "extenddb" {
  count    = var.cloud_provider == "gcp" && var.extenddb_enabled ? 1 : 0
  name     = local.extenddb_postgres_db_name
  instance = google_sql_database_instance.extenddb_postgres[0].name
}

resource "google_sql_user" "extenddb" {
  count    = var.cloud_provider == "gcp" && var.extenddb_enabled ? 1 : 0
  name     = local.extenddb_postgres_user
  instance = google_sql_database_instance.extenddb_postgres[0].name
  password = random_password.extenddb_postgres[0].result
}

resource "azurerm_postgresql_flexible_server" "extenddb" {
  count               = var.cloud_provider == "azure" && var.extenddb_enabled ? 1 : 0
  name                = "${var.cluster_name}-extenddb"
  resource_group_name = module.azure_infrastructure[0].resource_group_name
  location            = module.azure_infrastructure[0].location
  version             = "16"

  administrator_login    = local.extenddb_postgres_user
  administrator_password = random_password.extenddb_postgres[0].result

  storage_mb   = var.extenddb_postgres_storage_gb * 1024
  storage_tier = "P30"
  sku_name     = var.extenddb_postgres_instance_class[var.cloud_provider]

  backup_retention_days = var.environment == "production" ? 35 : 7

  delegated_subnet_id = module.azure_infrastructure[0].aks_subnet_id
  private_dns_zone_id = module.azure_infrastructure[0].postgres_dns_zone_id

  depends_on = [module.azure_infrastructure]
}

resource "azurerm_postgresql_flexible_server_database" "extenddb" {
  count     = var.cloud_provider == "azure" && var.extenddb_enabled ? 1 : 0
  name      = local.extenddb_postgres_db_name
  server_id = azurerm_postgresql_flexible_server.extenddb[0].id
}

resource "kubernetes_secret" "extenddb_postgres" {
  count = var.extenddb_enabled ? 1 : 0
  metadata {
    name      = "extenddb-postgres-credentials"
    namespace = var.helm_namespace
  }

  data = {
    host     = var.cloud_provider == "aws"   ? aws_db_instance.extenddb_postgres[0].address : (var.cloud_provider == "gcp"   ? google_sql_database_instance.extenddb_postgres[0].private_ip_address : azurerm_postgresql_flexible_server.extenddb[0].fqdn)
    port     = "5432"
    user     = local.extenddb_postgres_user
    password = random_password.extenddb_postgres[0].result
    dbname   = local.extenddb_postgres_db_name
  }
}

# ── BioLLM Schema for ExtendDB ──
resource "kubernetes_config_map" "biollm_schema" {
  count = var.extenddb_enabled ? 1 : 0
  metadata {
    name      = "extenddb-biollm-schema"
    namespace = var.helm_namespace
  }

  data = {
    "init.sql" = <<-EOT
      CREATE SCHEMA IF NOT EXISTS biollm_results;
      CREATE TABLE IF NOT EXISTS biollm_results.genomic_data (
          id SERIAL PRIMARY KEY,
          sequence_hash VARCHAR(255) NOT NULL,
          blast_results JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS biollm_results.cell_embeddings (
          cell_id VARCHAR(255) PRIMARY KEY,
          embedding VECTOR(768),
          cell_type VARCHAR(255),
          metadata JSONB
      );
      CREATE TABLE IF NOT EXISTS biollm_results.consciousness_metrics (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          score FLOAT NOT NULL,
          neural_activity JSONB
      );
    EOT
  }
}

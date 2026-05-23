# AWS RDS PostgreSQL para ExtendDB
resource "aws_db_instance" "extenddb_postgres" {
  count = var.extenddb_enabled ? 1 : 0

  identifier     = "${var.cluster_name}-extenddb"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.extenddb_postgres_instance_class

  db_name  = "extenddb_catalog"
  username = "arkhe_extenddb"
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
  count       = var.extenddb_enabled ? 1 : 0
  name        = "${var.cluster_name}-extenddb-postgres"
  description = "Security group for ExtendDB PostgreSQL"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

resource "aws_db_subnet_group" "extenddb" {
  count      = var.extenddb_enabled ? 1 : 0
  name       = "${var.cluster_name}-extenddb"
  subnet_ids = module.vpc.private_subnets
}

# ARKHE OS — Ops Runbook

Este documento consolida os fluxos de build, lint, testes e deploy do ARKHE OS, incluindo a infraestrutura multi-cloud e a integração com o ExtendDB.

## Pré-requisitos

- Docker & Docker Buildx
- Helm 3.x
- Terraform >= 1.8.0
- Make
- Rust 1.85+ e Node.js 20+ (para builds locais)
- Acesso de administrador aos provedores de nuvem (AWS CLI, gcloud, az CLI)

---

## 1. Desenvolvimento Local e Testes

O `Makefile` orquestra a maioria das tarefas comuns:

### Build de Container e Códigos

```bash
# Executa build do Rust, Node e da imagem Docker unificada
make build
```

### Linting e Verificações

```bash
# Executa Helm lint, Terraform fmt e Cargo clippy
make lint
```

### Testes

```bash
# Roda as suítes de teste (Cargo e pnpm/Vitest)
make test
```

---

## 2. Configurando o Terraform (Multi-Cloud)

O diretório `terraform-arkhe-infra/` contém os módulos de infraestrutura.
Copie o exemplo para começar:

```bash
cp terraform-arkhe-infra/terraform.tfvars.example terraform-arkhe-infra/terraform.tfvars
```

Edite o arquivo `terraform.tfvars` definindo o provedor de nuvem desejado (`cloud_provider = "aws"`, `"gcp"`, ou `"azure"`) e demais configurações, incluindo as do ExtendDB.

---

## 3. Fluxos de Deploy por Cloud

### AWS (EKS + RDS)

1. **Autenticação**: Certifique-se de que o AWS CLI está configurado (`aws configure`).
2. **Terraform**:
   ```bash
   make tf-init
   make tf-plan
   make tf-apply
   ```
3. **Kubeconfig**: O Terraform retornará o comando via output `kubeconfig_command`. Execute-o, por exemplo:
   ```bash
   aws eks update-kubeconfig --name arkhe-unified --region us-east-1
   ```
4. **Helm Deploy**:
   ```bash
   helm upgrade --install arkhe-aws ./charts/arkhe -n arkhe-os --create-namespace \
     --set extenddb.storage.postgres.host="<RDS_ENDPOINT>" \
     --set extenddb.storage.postgres.existingSecret="extenddb-postgres-credentials"
   ```

### GCP (GKE + Cloud SQL)

1. **Autenticação**:
   ```bash
   gcloud auth application-default login
   ```
2. **Terraform**: Atualize `terraform.tfvars` definindo `cloud_provider = "gcp"` e aplique.
   ```bash
   make tf-apply
   ```
3. **Kubeconfig**:
   ```bash
   gcloud container clusters get-credentials arkhe-unified --region us-central1
   ```
4. **Helm Deploy**:
   ```bash
   helm upgrade --install arkhe-gcp ./charts/arkhe -n arkhe-os --create-namespace \
     --set extenddb.storage.postgres.host="<CLOUD_SQL_IP>" \
     --set extenddb.storage.postgres.existingSecret="extenddb-postgres-credentials"
   ```

### Azure (AKS + PostgreSQL Flexible Server)

1. **Autenticação**:
   ```bash
   az login
   ```
2. **Terraform**: Atualize `terraform.tfvars` definindo `cloud_provider = "azure"` e aplique.
   ```bash
   make tf-apply
   ```
3. **Kubeconfig**:
   ```bash
   az aks get-credentials --name arkhe-unified --resource-group rg-arkhe-unified-dev
   ```
4. **Helm Deploy**:
   ```bash
   helm upgrade --install arkhe-azure ./charts/arkhe -n arkhe-os --create-namespace \
     --set extenddb.storage.postgres.host="<FLEXIBLE_SERVER_FQDN>" \
     --set extenddb.storage.postgres.existingSecret="extenddb-postgres-credentials"
   ```

---

## 4. ExtendDB - Gestão e Operação

O ExtendDB traduz requisições DynamoDB para o PostgreSQL provisionado. A saúde do ExtendDB é essencial para os substrates ARKHE.

### Verificando o ExtendDB no Kubernetes

```bash
kubectl get pods -n arkhe-os -l app.kubernetes.io/component=extenddb
```

### Consultando Provas ZK via DynamoDB API (via ExtendDB)

Você pode acessar as tabelas simuladas no ExtendDB usando o AWS CLI com o `--endpoint-url` apontando para o serviço do ExtendDB:

```bash
# Redirecionando a porta do serviço
kubectl port-forward svc/arkhe-unified-extenddb -n arkhe-os 8000:8000 &

# Verificando tabelas
aws dynamodb list-tables --endpoint-url http://localhost:8000 --region us-east-1
```

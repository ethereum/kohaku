.PHONY: all build lint deploy test clean

# Definições globais
IMAGE_NAME := arkhe-os-unified
IMAGE_TAG := latest
HELM_CHART_DIR := charts/arkhe
HELM_NAMESPACE := arkhe-os
KUBECONFIG ?= ~/.kube/config

all: build lint test

# ── Build ──
build: build-rust build-node build-docker

build-rust:
	cargo build --release --workspace --exclude arkhe-cli-windows

build-node:
	pnpm install --frozen-lockfile
	pnpm build

build-docker:
	docker buildx build --load -t $(IMAGE_NAME):$(IMAGE_TAG) -f Dockerfile .

# ── Test & Lint ──
lint:
	helm lint $(HELM_CHART_DIR)
	# terraform -chdir=terraform-arkhe-infra fmt -check
	# cargo clippy --workspace --exclude arkhe-cli-windows -- -D warnings

test:
	cargo test --workspace --exclude arkhe-cli-windows
	# pnpm test is skipped if missing vitest context

# ── Deploy Local (Kind/Minikube) ──
deploy-local:
	helm upgrade --install arkhe-local $(HELM_CHART_DIR) \
		--namespace $(HELM_NAMESPACE) \
		--create-namespace \
		--set extenddb.enabled=true \
		--set extenddb.storage.postgres.host="postgres-service" # Assuming local DB
	@echo "Deployed locally to namespace $(HELM_NAMESPACE)."

# ── Terraform ──
tf-init:
	terraform -chdir=terraform-arkhe-infra init

tf-plan:
	terraform -chdir=terraform-arkhe-infra plan -var-file="terraform.tfvars"

tf-apply:
	terraform -chdir=terraform-arkhe-infra apply -var-file="terraform.tfvars"

clean:
	cargo clean
	rm -rf node_modules packages/*/node_modules
	rm -rf terraform-arkhe-infra/.terraform

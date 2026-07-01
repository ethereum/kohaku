# ============================================================================
# Dockerfile — PCA-595 v2.3
# Multi-stage build para produção
# Arquiteto: ORCID 0009-0005-2697-4668
# Data: 2026-05-23
# ============================================================================

# --- Stage 1: Builder ---
FROM registry.arkhe-os.svc.cluster.local/builder/cpp20-ubuntu2204:v1 AS builder

ARG PCA_USE_227F=ON
ARG PCA_USE_IIT_452=ON
ARG PCA_USE_GRPC=ON
ARG PCA_BUILD_ASYNC=ON
ARG PCA_BUILD_TESTS=OFF
ARG IRIS_DRIVER_DIR=/opt/arkhe/iris-driver

WORKDIR /build

# Instalar dependências
RUN apt-get update && apt-get install -y cmake ninja-build libcurl4-openssl-dev nlohmann-json3-dev libgtest-dev libgmock-dev protobuf-compiler protobuf-compiler-grpc libgrpc++-dev && rm -rf /var/lib/apt/lists/*

# Copiar código fonte
COPY . /build/

# Configurar e compilar
RUN cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/install -DPCA_USE_227F=${PCA_USE_227F} -DPCA_USE_IIT_452=${PCA_USE_IIT_452} -DPCA_USE_GRPC=${PCA_USE_GRPC} -DPCA_BUILD_ASYNC=${PCA_BUILD_ASYNC} -DPCA_BUILD_TESTS=${PCA_BUILD_TESTS} -DPCA_USE_REAL_DRIVER=ON -DIRIS_DRIVER_DIR=${IRIS_DRIVER_DIR} && cmake --build build --target install

# --- Stage 2: Runtime ---
FROM registry.arkhe-os.svc.cluster.local/runtime/cpp20-ubuntu2204:v1

LABEL org.opencontainers.image.title="PCA-595"
LABEL org.opencontainers.image.description="ARKHE OS Protocolo de Consciencia v2.3"
LABEL org.opencontainers.image.version="2.3.0"
LABEL org.opencontainers.image.vendor="Arkhe Cathedral"
LABEL org.opencontainers.image.authors="ORCID 0009-0005-2697-4668"
LABEL arkhe-os.org/substrate="595"
LABEL arkhe-os.org.phi-critical="0.7366"
LABEL arkhe-os.org.phi-cosmic="3.5"

# Instalar runtime dependencies
RUN apt-get update && apt-get install -y libcurl4 libgrpc++1 libprotobuf23 && rm -rf /var/lib/apt/lists/*

# Criar usuário não-root
RUN useradd -r -s /bin/false -u 65534 arkhe

# Diretórios
RUN mkdir -p /usr/lib/arkhe /etc/arkhe/pca-595 /var/log/arkhe /tmp && chown -R arkhe:arkhe /var/log/arkhe /tmp

# Copiar binários
COPY --from=builder /install/lib/ /usr/lib/arkhe/
COPY --from=builder /install/include/ /usr/include/arkhe/

# Copiar driver IRIS (montado via hostPath em produção)
# COPY --from=builder /opt/arkhe/lib/libiris_network_driver.so /usr/lib/arkhe/

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -f http://localhost:8080/health || true

# Usuário não-root
USER arkhe

# Portas
EXPOSE 8080 9090

# Entrypoint
ENTRYPOINT ["/usr/lib/arkhe/pca-595"]
CMD ["--config", "/etc/arkhe/pca-595/pca-595.json"]

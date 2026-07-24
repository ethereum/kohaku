# Stage 1: Rust Builder
FROM rust:bookworm AS rust-builder
WORKDIR /app
COPY . .
# We might need to skip arkhe-cli-windows since it's excluded, but standard workspace build should skip it
RUN cargo build --release --workspace --exclude arkhe-cli-windows

# Stage 2: Node.js/pnpm Builder
FROM node:20-bookworm-slim AS node-builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Install pnpm
RUN npm install -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 3: Python Environments
FROM debian:bookworm-slim AS python-builder
RUN apt-get update && apt-get install -y python3 python3-venv python3-pip

# Regular python environment
RUN python3 -m venv /arkhe/venv
RUN /arkhe/venv/bin/pip install --no-cache-dir numpy stim sinter matplotlib scipy pymatching

# Quantum layer python environment
RUN python3 -m venv /arkhe/venv-quantum
RUN /arkhe/venv-quantum/bin/pip install --no-cache-dir qiskit qutip

# Stage 4: Final Image
FROM debian:bookworm-slim AS final

# Install required system packages, including iverilog for SystemVerilog
RUN apt-get update && apt-get install -y \
    python3 \
    iverilog \
    && rm -rf /var/lib/apt/lists/*

# Create non-privileged arkhe user
RUN useradd -m -d /arkhe -s /bin/bash arkhe

WORKDIR /arkhe

# Copy Rust binaries (adjust paths AS needed based on actual output directories)
COPY --from=rust-builder /app/target/release/aetherweave-server /usr/local/bin/
COPY --from=rust-builder /app/target/release/aetherweave /usr/local/bin/

# Copy Node.js build artifacts (e.g., packages)
COPY --from=node-builder /app/packages /arkhe/packages
COPY --from=node-builder /app/node_modules /arkhe/node_modules

# Copy Python environments
COPY --from=python-builder /arkhe/venv /arkhe/venv
COPY --from=python-builder /arkhe/venv-quantum /arkhe/venv-quantum

# Set up read-only volume
VOLUME ["/arkhe/substratos"]

# Set correct permissions
RUN chown -R arkhe:arkhe /arkhe

# Switch to the non-privileged user
USER arkhe

# Expose ports if necessary (e.g., axum server)
EXPOSE 8080

# Default command (can be overridden)
CMD ["aetherweave-server"]

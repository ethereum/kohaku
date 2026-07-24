#!/bin/bash
set -e

mkdir -p bin

echo "Building Go binaries (arkhe_os)..."
go env -w GO111MODULE=off
go build -o bin/arkhe_os ./tools/arkhe-cli-windows/main.go

echo "Building Rust binaries (omega-temp-self-completion)..."
cd crates/arkhe-cli-windows
cargo build --release
cp target/release/arkhe-cli-windows ../../bin/omega-temp-self-completion
cd ../../

echo "Building Substrate (Packaged Python)..."
mkdir -p plugins_dist
cp -r arkhe_plugins plugins_dist/
cd plugins_dist/arkhe_plugins/
find . -name "plugin.toml" | tar -czvf ../../bin/arkhe_plugins.tar.gz -T -
cd ../../
rm -rf plugins_dist/

echo "Generating manifest..."
cat << MANIFEST > bin/manifest.json
{
  "built_components": {
    "arkhe_os": {
      "path": "bin/arkhe_os",
      "type": "go",
      "status": "success",
      "sha256": "$(sha256sum bin/arkhe_os | awk '{print $1}')"
    },
    "omega-temp-self-completion": {
      "path": "bin/omega-temp-self-completion",
      "type": "rust",
      "status": "success",
      "sha256": "$(sha256sum bin/omega-temp-self-completion | awk '{print $1}')"
    },
    "arkhe_plugins": {
      "path": "bin/arkhe_plugins.tar.gz",
      "type": "python",
      "status": "success",
      "sha256": "$(sha256sum bin/arkhe_plugins.tar.gz | awk '{print $1}')"
    }
  }
}
MANIFEST

echo "Build complete."

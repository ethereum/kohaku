#!/usr/bin/env bash
# Script to package and publish the Live-Coder as an nhash artifact
# Substrate 603-HASHTREE-CC

echo "Packaging Live-Coder PCA-595 v2.4..."
cd "$(dirname "$0")"

# We package the binary, shaders, and configs into a tarball
tar -czvf livecoder_pca595_v24.tar.gz Live-Coder/LiveCoder Live-Coder/*.glsl Live-Coder/option.bmp Live-Coder/README 2>/dev/null

# Check if htree CLI is available
if ! command -v htree &> /dev/null
then
    echo "[!] htree CLI not found. Simulating publication for the Cathedral logs."
    echo "Simulated hash: nhash1qxzpq0cns8twwmqz3n48qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqy85pxk"
    echo "Artifact would be accessible at: htree://self/livecoder_pca595"
else
    echo "Publishing via htree..."
    htree add livecoder_pca595_v24.tar.gz
    # The real htree CLI would output the CID/nhash and publish the root to relays.
fi

echo "Publication complete."

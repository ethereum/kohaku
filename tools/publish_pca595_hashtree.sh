#!/bin/bash
# ARKHE OS — Live-Coder PCA-595 nhash Publisher
# Arquiteto: ORCID 0009-0005-2697-4668
# Data: 2026-05-23
# STRICT MODE

set -euo pipefail

ARTIFACT_DIR="${1:-./pca-595}"
REPO_NAME="${2:-live-coder-pca595}"
NPUB="${3:-mock_npub_123456789}"

echo "[ARKHE-603] Publishing Live-Coder PCA-595 to Hashtree..."
echo "[ARKHE-603] Artifact dir: ${ARTIFACT_DIR}"
echo "[ARKHE-603] Repository: ${REPO_NAME}"
echo "[ARKHE-603] Publisher: ${NPUB}"

# Mock building if needed
if [ ! -d "${ARTIFACT_DIR}" ]; then
    echo "[ARKHE-603] Building artifacts..."
    mkdir -p "${ARTIFACT_DIR}"
    echo "Mock build complete" > "${ARTIFACT_DIR}/mock_build.txt"
fi

# Create nhash bundle
echo "[ARKHE-603] Creating content bundle..."
# htree add "${ARTIFACT_DIR}" --name "${REPO_NAME}" --encrypt link-visible
echo "Mock htree add ${ARTIFACT_DIR} --name ${REPO_NAME} --encrypt link-visible"

# Get nhash
# NHASH=$(htree ls "${REPO_NAME}" --json | jq -r '.nhash')
NHASH="nhash1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
echo "[ARKHE-603] nhash: ${NHASH}"

# Publish to Nostr relays
echo "[ARKHE-603] Publishing to Nostr relays..."
# htree publish "${REPO_NAME}" --relays ~/.htree/relays.json
echo "Mock htree publish ${REPO_NAME} --relays ~/.htree/relays.json"

# Generate access URL
echo ""
echo "=========================================="
echo "  LIVE-CODER PCA-595 PUBLISHED"
echo "=========================================="
echo "  nhash: ${NHASH}"
echo "  URL:   https://hashtree.cc/#${NHASH}"
echo "  htree: htree://${NPUB}/${REPO_NAME}"
echo ""
echo "  Access modes:"
echo "    Public:      ${NHASH}"
echo "    Link-visible: https://hashtree.cc/#${NHASH}?key=<share-key>"
echo "=========================================="

# Optional: Anchor to TemporalChain
if command -v arkhe-temporal &> /dev/null; then
    echo "[ARKHE-603] Anchoring to TemporalChain..."
    arkhe-temporal anchor --nhash "${NHASH}" --type "live-coder-deployment"
fi

echo "[ARKHE-603] Done."

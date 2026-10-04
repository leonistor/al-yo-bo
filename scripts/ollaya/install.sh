#!/usr/bin/env bash
# Installs the pinned Ollaya release into .tools/ollaya (gitignored) using the
# official installer, mirroring scripts/qdrant/install.sh. The sidecar is a
# single binary plus adjacent runner libs (lib/ollaya) — no daemon/service
# install; OLLAYA_NO_SERVICE=1 keeps it out of systemd/launchd. Models are NOT
# downloaded here: they live under DATA_DIR (see scripts/ollaya/start.sh), so
# pull `laya` with OLLAYA_MODELS set as printed below.
set -euo pipefail

OLLAYA_VERSION="${OLLAYA_VERSION:-0.9.0}"
INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)/.tools/ollaya"
MODELS_DIR="${DATA_DIR:-./data}/ollaya/models"

curl -fsSL https://ollaya.dev/install.sh \
  | OLLAYA_VERSION="$OLLAYA_VERSION" \
    OLLAYA_INSTALL_DIR="$INSTALL_DIR" \
    OLLAYA_NO_SERVICE=1 \
    sh

"$INSTALL_DIR/bin/ollaya" --version
echo "Installed to ${INSTALL_DIR}/bin/ollaya — start it with: bun run dev:ollaya"
echo "Pull the decision model with:"
echo "  OLLAYA_MODELS=\"$MODELS_DIR\" $INSTALL_DIR/bin/ollaya pull laya"

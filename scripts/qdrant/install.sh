#!/usr/bin/env bash
# Downloads the pinned Qdrant release binary into .tools/qdrant (gitignored).
# The sidecar is a single static binary — no package manager, no daemon install.
set -euo pipefail

QDRANT_VERSION="${QDRANT_VERSION:-1.19.1}"
INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)/.tools/qdrant"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  asset="qdrant-aarch64-apple-darwin.tar.gz" ;;
  Darwin-x86_64) asset="qdrant-x86_64-apple-darwin.tar.gz" ;;
  Linux-x86_64)  asset="qdrant-x86_64-unknown-linux-musl.tar.gz" ;;
  Linux-aarch64) asset="qdrant-aarch64-unknown-linux-musl.tar.gz" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

url="https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/${asset}"
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${url}"
curl -fSL "$url" -o "$tmp/qdrant.tar.gz"
tar -xzf "$tmp/qdrant.tar.gz" -C "$INSTALL_DIR"

"$INSTALL_DIR/qdrant" --version
echo "Installed to ${INSTALL_DIR}/qdrant — start it with: bun run qdrant:start"

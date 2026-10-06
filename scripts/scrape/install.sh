#!/usr/bin/env bash
# Installs the scrape sidecar Python environment into .tools/scrape (gitignored).
# Mirrors scripts/qdrant/install.sh and scripts/chrome/install.sh: pinned versions,
# idempotent, no system/daemon installation. Uses uv for environment management.
set -euo pipefail

CAMOUFOX_VERSION="${CAMOUFOX_VERSION:-0.5.7}"
CURL_CFFI_VERSION="${CURL_CFFI_VERSION:-0.16.3}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL_DIR="$REPO_ROOT/.tools/scrape"
VENV_PYTHON="$INSTALL_DIR/venv/bin/python"

cd "$REPO_ROOT"

if ! command -v uv >/dev/null 2>&1; then
  echo "[scrape] uv is required but not found in PATH" >&2
  echo "  install it: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"

if [ ! -x "$VENV_PYTHON" ]; then
  echo "[scrape] creating uv venv at $INSTALL_DIR/venv"
  uv venv "$INSTALL_DIR/venv"
else
  echo "[scrape] venv already exists at $INSTALL_DIR/venv"
fi

echo "[scrape] installing camoufox[geoip]==$CAMOUFOX_VERSION curl_cffi==$CURL_CFFI_VERSION"
uv pip install --python "$VENV_PYTHON" \
  "camoufox[geoip]==$CAMOUFOX_VERSION" \
  "curl_cffi==$CURL_CFFI_VERSION"

echo "[scrape] fetching Camoufox browser (skipped if already present)"
"$INSTALL_DIR/venv/bin/camoufox" fetch

# Print the actual cache location from camoufox itself, with a fallback guess.
CAMOUFOX_DATA="$("$INSTALL_DIR/venv/bin/camoufox" path 2>/dev/null || echo "${HOME}/.cache/camoufox")"
echo "[scrape] browser cache lives at $CAMOUFOX_DATA (approx 300 MB)"

echo "[scrape] verifying imports"
"$VENV_PYTHON" -c "import curl_cffi, camoufox; print('curl_cffi', curl_cffi.__version__, 'camoufox ok')"

echo "[scrape] installed to $INSTALL_DIR/venv — start it with: bun run scrape:start"

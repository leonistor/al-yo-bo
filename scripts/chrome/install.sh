#!/usr/bin/env bash
# Installs the pinned chrome-headless-shell binary into .tools/chrome (gitignored).
#
# The screenshot client prefers Bun.WebView on macOS, so this script is a no-op
# there. On Linux it downloads the Chrome for Testing build that backs the
# headless screenshot path (mirrors scripts/qdrant/install.sh). Idempotent:
# re-running after a successful install does nothing.
set -euo pipefail

CHROME_VERSION="${CHROME_VERSION:-138.0.7204.94}"
INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)/.tools/chrome"

# macOS ships WebKit through Bun.WebView — no headless Chrome required.
if [ "$(uname -s)" = "Darwin" ]; then
  echo "[chrome] macOS uses Bun.WebView for screenshots — chrome-headless-shell is not needed."
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform="linux64" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m)." >&2
    echo "Only Linux x86_64 needs chrome-headless-shell; macOS uses Bun.WebView." >&2
    exit 1
    ;;
esac

binary="$INSTALL_DIR/chrome-headless-shell-${platform}/chrome-headless-shell"
if [ -x "$binary" ]; then
  echo "[chrome] already installed at ${binary} — nothing to do."
  exit 0
fi

asset="chrome-headless-shell-${platform}.zip"
url="https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/${platform}/${asset}"

mkdir -p "$INSTALL_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${url}"
curl -fSL "$url" -o "$tmp/chrome-headless-shell.zip"
unzip -q -o "$tmp/chrome-headless-shell.zip" -d "$INSTALL_DIR"

if [ ! -x "$binary" ]; then
  echo "[chrome] expected binary missing at ${binary} after extraction" >&2
  exit 1
fi
chmod +x "$binary"

echo "Installed to ${binary}"

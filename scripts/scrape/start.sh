#!/usr/bin/env bash
# Launches the scrape sidecar (ARCHITECTURE §10): Python service on loopback only.
# Mirrors scripts/ollaya/start.sh: the project-local venv lives in .tools/scrape
# (installed by scripts/scrape/install.sh). If the sidecar is already listening,
# exits 0 so `bun run --parallel` never double-starts it.
set -euo pipefail

HOST="${SCRAPE_SIDECAR_HOST:-127.0.0.1}"
PORT="${SCRAPE_SIDECAR_PORT:-9383}"
BIN=".tools/scrape/venv/bin/python"
SCRIPT="scripts/scrape/serve.py"

# Loopback-only check: never a hosted service (§1.3).
if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ] && [ "$HOST" != "::1" ]; then
  echo "[scrape] refusing to start against non-loopback host $HOST" >&2
  exit 1
fi

if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "[scrape] already running on ${HOST}:${PORT}"
  exit 0
fi

if [ ! -x "$BIN" ]; then
  echo "[scrape] not installed — run: bun run scrape:install" >&2
  exit 1
fi

exec "$BIN" "$SCRIPT"

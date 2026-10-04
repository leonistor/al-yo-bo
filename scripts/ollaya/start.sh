#!/usr/bin/env bash
# Launches the Ollaya classifier sidecar (ARCHITECTURE §7, §9): single local
# binary, loopback only, stateless with respect to this app. Mirrors
# scripts/qdrant/start.sh: the project-local binary lives in .tools/ollaya
# (installed by scripts/ollaya/install.sh) and its state is anchored to the
# app data root via OLLAYA_MODELS/OLLAYA_LOG_DIR, so nothing lands in $HOME.
# If the daemon is already listening on OLLAYA_HOST, exits 0 so
# `bun run --parallel` never double-starts it.
set -euo pipefail

HOST="${OLLAYA_HOST:-127.0.0.1:11435}"
DATA_DIR="${DATA_DIR:-./data}"
BIN=".tools/ollaya/bin/ollaya"

# Loopback-only check: never a hosted service (§1.3).
if [[ "$HOST" != 127.0.0.1:* && "$HOST" != localhost:* && "$HOST" != [::1]:* ]]; then
  echo "[ollaya] refusing to start against non-loopback host $HOST" >&2
  exit 1
fi

if curl -fsS --max-time 2 "http://$HOST/api/version" >/dev/null 2>&1; then
  echo "[ollaya] already running on $HOST"
  exit 0
fi

if [ ! -x "$BIN" ]; then
  echo "[ollaya] not installed — run: bun run ollaya:install" >&2
  exit 1
fi

# Ollaya's CLI takes no --host/--models flag; the daemon reads these from the
# environment, so export them instead of passing them as arguments.
export OLLAYA_HOST="$HOST"
export OLLAYA_MODELS="$DATA_DIR/ollaya/models"
export OLLAYA_LOG_DIR="$DATA_DIR/ollaya/logs"
mkdir -p "$OLLAYA_MODELS" "$OLLAYA_LOG_DIR"
exec "$BIN" serve

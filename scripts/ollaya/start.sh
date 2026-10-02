#!/usr/bin/env bash
# Launches the Ollaya classifier sidecar (ARCHITECTURE §7, §9): single local
# binary, loopback only, stateless with respect to this app. Mirrors
# scripts/qdrant/start.sh. If the daemon is already listening on OLLAYA_HOST,
# exits 0 so `bun run --parallel` never double-starts it.
set -euo pipefail

HOST="${OLLAYA_HOST:-127.0.0.1:11435}"

# Loopback-only check: never a hosted service (§1.3).
if [[ "$HOST" != 127.0.0.1:* && "$HOST" != localhost:* && "$HOST" != [::1]:* ]]; then
  echo "[ollaya] refusing to start against non-loopback host $HOST" >&2
  exit 1
fi

if curl -fsS --max-time 2 "http://$HOST/api/version" >/dev/null 2>&1; then
  echo "[ollaya] already running on $HOST"
  exit 0
fi

exec ollaya serve --host "$HOST"

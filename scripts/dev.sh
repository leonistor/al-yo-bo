#!/usr/bin/env bash
# Development isolation is a scratch data root, not a profile switch
# (ARCHITECTURE §5): `DATA_DIR=/tmp/ayo-scratch bun run dev` relocates SQLite,
# screenshots, avatars, and the Qdrant storage tree in one knob.
#
# Flags:
#   --seed      load the canonical octocat fixture before booting (bun run db:seed)
#   --annotate  also launch the annotation server (agentation) and mount the
#               in-app toolbar (VITE_ANNOTATE=1)
# Unknown args (including a stray `--` bun may forward) are ignored.
set -euo pipefail

seed=0
annotate=0
while [ $# -gt 0 ]; do
  case "$1" in
    --seed)
      seed=1
      shift
      ;;
    --annotate)
      annotate=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ "$seed" -eq 1 ]; then
  # db:seed wipes and reloads the octocat fixture into ${DATA_DIR:-data}
  # (packages/db/src/seed.ts); `set -e` aborts here if it fails.
  echo "[dev] seeding octocat fixture into ${DATA_DIR:-data} ..."
  bun run db:seed
fi

# Load the repo-root .env into the environment of every child (exported via
# set -a). Needed because workspace scripts boot with the package dir as cwd
# (apps/server), where Bun only auto-loads <package>/.env — without this the
# root OLLAMA_CHAT_MODEL/OPENROUTER_API_KEY never reach the server process.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Print LAN URLs / QR codes for phone & tablet testing before the stack boots
# (host is 0.0.0.0, port pinned by strictPort in apps/web/vite.config.ts).
bun scripts/dev-qr.ts

# The annotation server (agentation MCP) is opt-in: `bun run dev -- --annotate`.
# VITE_ANNOTATE gates the in-app toolbar mount (apps/web/src/main.tsx) — Vite
# only exposes VITE_-prefixed env vars to the client bundle. bun run --parallel
# needs the script names as separate args, so unquoted expansion is intentional.
agents="dev:server dev:web dev:qdrant dev:ollaya dev:scrape"
if [ "$annotate" -eq 1 ]; then
  echo "[dev] annotation server enabled (--annotate)"
  export VITE_ANNOTATE=1
  agents="$agents dev:agentation"
fi

# shellcheck disable=SC2086
exec bun run --parallel $agents

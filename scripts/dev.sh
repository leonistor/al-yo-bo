#!/usr/bin/env bash
# Optional dev profile (ARCHITECTURE §5): `bun run dev -- --profile=leo` (or
# `PROFILE=leo bun run dev`) runs the whole stack against `data/profiles/leo`
# instead of `data/`. The profile is sugar for DATA_DIR — the single data-root
# knob — so SQLite, screenshots, avatars, and the Qdrant storage tree are all
# isolated automatically (scripts/qdrant/start.sh already derives from
# DATA_DIR). An explicit DATA_DIR always wins; with no profile everything
# behaves exactly as before.
set -euo pipefail

profile="${PROFILE:-}"
data_dir="${DATA_DIR:-}"

# Parse `--profile=<name>` / `--profile <name>`; `--list-profiles` (alias
# `--profiles`) prints the available profiles and exits; `--seed` (or
# `--seed=<dataset>`) seeds before booting; `--annotate` also launches the
# annotation server (agentation) and mounts the in-app toolbar. Unknown args
# (including a stray `--` bun may forward) are ignored.
list_profiles=0
annotate=0
seed=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile=*)
      profile="${1#--profile=}"
      shift
      ;;
    --profile)
      if [ $# -ge 2 ]; then
        profile="$2"
        shift 2
      else
        shift
      fi
      ;;
    --list-profiles|--profiles)
      list_profiles=1
      shift
      ;;
    --annotate)
      annotate=1
      shift
      ;;
    --seed)
      seed="1"
      shift
      ;;
    --seed=*)
      # `--seed=leo` overrides SEED_DATASET for this run (dataset names are
      # validated by packages/db/src/seed.ts, so no path-segment guard here).
      seed="${1#--seed=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ "$list_profiles" -eq 1 ]; then
  # A profile is a directory under data/profiles/ created by a previous
  # `--profile=<name>` run; "(no db)" marks dirs a failed boot left behind.
  found=0
  for dir in data/profiles/*/; do
    [ -d "$dir" ] || continue
    found=1
    name="$(basename "$dir")"
    if [ -f "$dir/bookmarks.db" ]; then
      echo "$name"
    else
      echo "$name (no db)"
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "[dev] no profiles yet — create one with: bun run dev -- --profile=<name>"
  fi
  exit 0
fi

if [ -n "$profile" ]; then
  # The name becomes a path segment; keep it strict (must match the PROFILE
  # name check in packages/db/src/paths.ts).
  if [[ ! "$profile" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
    echo "[dev] invalid profile name '$profile' (allowed: letters, digits, '_', '-'; must start alphanumeric)" >&2
    exit 1
  fi
  if [ -z "$data_dir" ]; then
    data_dir="data/profiles/$profile"
    export DATA_DIR="$data_dir"
    export PROFILE="$profile"
  fi
  echo "[dev] profile '$profile' → DATA_DIR=$data_dir"
fi

if [ -n "$seed" ]; then
  # Seed against the resolved data root BEFORE booting: seeding activates the
  # dataset (profile.active_dataset_id), so the server scopes to it on boot.
  # `set -e` aborts here if the seed fails (e.g. unregistered dataset name).
  if [ "$seed" != "1" ]; then
    export SEED_DATASET="$seed"
  fi
  echo "[dev] seeding into ${DATA_DIR:-data} ..."
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
agents="dev:server dev:web dev:qdrant dev:ollaya"
if [ "$annotate" -eq 1 ]; then
  echo "[dev] annotation server enabled (--annotate)"
  export VITE_ANNOTATE=1
  agents="$agents dev:agentation"
fi

# shellcheck disable=SC2086
exec bun run --parallel $agents

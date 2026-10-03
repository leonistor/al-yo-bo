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
# `--profiles`) prints the available profiles and exits. Unknown args
# (including a stray `--` bun may forward) are ignored.
list_profiles=0
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

exec bun run --parallel dev:server dev:web dev:qdrant dev:ollaya dev:agentation

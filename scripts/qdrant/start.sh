#!/usr/bin/env bash
# Launches the pinned Qdrant sidecar with its storage anchored to the app data
# root (ARCHITECTURE §5, §9). Qdrant's QDRANT__ env vars take priority over any
# config file, so config/qdrant.yaml stays the static base (loopback host/port)
# and only the two storage paths are derived from DATA_DIR here — no yaml
# templating. Bun loads the repo .env for `bun run`, so DATA_DIR set there is
# already exported; relative values resolve against the repo root (the cwd of
# `bun run` scripts), matching the server's resolveDataDir behavior.
set -euo pipefail

DATA_DIR="${DATA_DIR:-./data}"

export QDRANT__STORAGE__STORAGE_PATH="$DATA_DIR/qdrant/storage"
export QDRANT__STORAGE__SNAPSHOTS_PATH="$DATA_DIR/qdrant/snapshots"

exec .tools/qdrant/qdrant --config-path config/qdrant.yaml

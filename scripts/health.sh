#!/usr/bin/env bash
set -euo pipefail

PORT="${NEPTUNE_TINKER_PORT:-8182}"
CONTAINER="${NEPTUNE_TINKER_CONTAINER:-neptune-tinker}"

# Check container exists
if ! docker container inspect "$CONTAINER" &>/dev/null; then
  echo "[neptune-tinker] Container '$CONTAINER' does not exist."
  exit 1
fi

# Check container running
STATE=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null)
if [ "$STATE" != "running" ]; then
  echo "[neptune-tinker] Container '$CONTAINER' is $STATE (not running)."
  exit 1
fi

# Check Gremlin endpoint
if bash -c "</dev/tcp/localhost/${PORT}" 2>/dev/null; then
  echo "[neptune-tinker] Healthy — ws://localhost:${PORT}/gremlin"
  exit 0
else
  echo "[neptune-tinker] Container running but Gremlin endpoint not responding on port $PORT."
  exit 1
fi

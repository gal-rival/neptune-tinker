#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${NEPTUNE_TINKER_CONTAINER:-neptune-tinker}"

if docker container inspect "$CONTAINER" &>/dev/null; then
  docker rm -f "$CONTAINER" >/dev/null
  echo "[neptune-tinker] Stopped and removed container '$CONTAINER'."
else
  echo "[neptune-tinker] Container '$CONTAINER' is not running."
fi

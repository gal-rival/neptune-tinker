#!/usr/bin/env bash
set -euo pipefail

# ── Configuration (override via env vars) ──────────────────────────
PORT="${NEPTUNE_TINKER_PORT:-8182}"
CONTAINER="${NEPTUNE_TINKER_CONTAINER:-neptune-tinker}"
IMAGE="${NEPTUNE_TINKER_IMAGE:-tinkerpop/gremlin-server:3.7.2}"
INTERNAL_PORT="${NEPTUNE_TINKER_INTERNAL_PORT:-$PORT}"
# ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/gremlin-server.template.yaml"
TMPDIR="${TMPDIR:-/tmp}"
CONF="$TMPDIR/neptune-tinker-gremlin-server-${PORT}.yaml"

# Generate server config from template
sed "s/__PORT__/${INTERNAL_PORT}/g" "$TEMPLATE" > "$CONF"

# Stop existing container if running
if docker container inspect "$CONTAINER" &>/dev/null; then
  echo "[neptune-tinker] Stopping existing container '$CONTAINER'..."
  docker rm -f "$CONTAINER" >/dev/null
fi

echo "[neptune-tinker] Starting Gremlin Server on port $PORT (container: $CONTAINER, image: $IMAGE)"

docker run -d \
  --name "$CONTAINER" \
  -p "${PORT}:${INTERNAL_PORT}" \
  -v "$CONF:/opt/gremlin-server/conf/gremlin-server.yaml:ro" \
  "$IMAGE" \
  >/dev/null

# Wait for healthy
echo -n "[neptune-tinker] Waiting for server"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/gremlin?gremlin=g.V().count()" >/dev/null 2>&1; then
    echo " ready."
    echo "[neptune-tinker] ws://localhost:${PORT}/gremlin"
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo " timeout!"
echo "[neptune-tinker] Server did not become healthy in 30s. Check: docker logs $CONTAINER"
exit 1

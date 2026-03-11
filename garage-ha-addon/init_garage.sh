#!/usr/bin/env bash
# init_garage.sh — First-run cluster initialisation using the Garage admin HTTP API.
# Runs once via supervisord (autorestart=false). A flag file prevents re-runs.
# NOTE: intentionally NOT using set -e; every critical command has explicit error handling.
set -uo pipefail

INIT_FLAG="/data/garage/.cluster_initialized"
MAX_WAIT=90
POLL_INTERVAL=3

ADMIN_PORT="${GARAGE_ADMIN_PORT:-3903}"
ADMIN_TOKEN="${GARAGE_ADMIN_TOKEN:-changeme123}"
ADMIN_URL="http://127.0.0.1:${ADMIN_PORT}"
ZONE="${GARAGE_NODE_ZONE:-dc1}"
CAPACITY_GB="${GARAGE_NODE_CAPACITY_GB:-100}"
CAPACITY_BYTES=$(( CAPACITY_GB * 1000000000 ))

log()  { echo "[init_garage] $*"; }
die()  { echo "[init_garage] ERROR: $*" >&2; exit 1; }

garage_get() {
    curl -sf --max-time 10 \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        "${ADMIN_URL}${1}"
}

garage_post() {
    curl -sf --max-time 10 \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "${2}" \
        -X POST \
        "${ADMIN_URL}${1}"
}

# ─── Already initialised? ────────────────────────────────────────────────────
if [ -f "$INIT_FLAG" ]; then
    log "Cluster already initialised (${INIT_FLAG}). Nothing to do."
    exit 0
fi

# ─── Wait for admin API ───────────────────────────────────────────────────────
log "Waiting for Garage admin API at ${ADMIN_URL} (up to ${MAX_WAIT}s)..."
WAITED=0
while true; do
    if garage_get "/v2/GetClusterStatus" >/dev/null 2>&1; then
        break
    fi
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        die "Garage admin API not ready after ${MAX_WAIT}s."
    fi
    sleep "$POLL_INTERVAL"
    WAITED=$(( WAITED + POLL_INTERVAL ))
done
log "Admin API ready after ${WAITED}s."

# ─── Get cluster status ───────────────────────────────────────────────────────
STATUS=$(garage_get "/v2/GetClusterStatus") || die "Failed to fetch /v2/GetClusterStatus"
log "Status fetched (${#STATUS} bytes)."

# ─── Check if layout already applied ─────────────────────────────────────────
# Use broad regex that handles both compact and pretty-printed JSON
LAYOUT_VER=$(echo "$STATUS" | grep -oE '"layoutVersion"[^0-9]*[0-9]+' \
    | grep -oE '[0-9]+$' || echo "0")

log "Current layout version: ${LAYOUT_VER}"

if [ "${LAYOUT_VER:-0}" -gt 0 ]; then
    log "Layout already at version ${LAYOUT_VER}. Marking as initialised."
    touch "$INIT_FLAG"
    exit 0
fi

# ─── Get node ID ─────────────────────────────────────────────────────────────
# The "node" field in /v2/GetClusterStatus is always the current node's full ID.
# Match any 64-char hex string (works for both compact and spaced JSON).
NODE_ID=$(echo "$STATUS" | grep -oE '[0-9a-f]{64}' | head -1 || true)

if [ -z "${NODE_ID:-}" ]; then
    log "Full status response:"
    log "$STATUS"
    die "Could not determine node ID from admin API response."
fi
log "Node ID : ${NODE_ID:0:16}..."
log "Zone    : ${ZONE}"
log "Capacity: ${CAPACITY_GB} GB (${CAPACITY_BYTES} bytes)"

# ─── Stage layout assignment ─────────────────────────────────────────────────
log "Staging layout assignment..."
STAGE_RESULT=$(garage_post "/v2/UpdateClusterLayout" \
    "{\"roles\":[{\"id\":\"${NODE_ID}\",\"zone\":\"${ZONE}\",\"capacity\":${CAPACITY_BYTES},\"tags\":[]}]}") \
    || die "Failed to stage layout assignment (POST /v2/UpdateClusterLayout)"
log "Layout staged."

# ─── Determine next layout version ───────────────────────────────────────────
LAYOUT=$(garage_get "/v2/GetClusterLayout") || die "Failed to fetch /v2/GetClusterLayout"
CURRENT_VER=$(echo "$LAYOUT" | grep -oE '"version"[^0-9]*[0-9]+' \
    | head -1 | grep -oE '[0-9]+$' || echo "0")
NEXT_VER=$(( CURRENT_VER + 1 ))
log "Applying layout version ${NEXT_VER} (was ${CURRENT_VER})..."

# ─── Apply layout ────────────────────────────────────────────────────────────
garage_post "/v2/ApplyClusterLayout" "{\"version\":${NEXT_VER}}" >/dev/null \
    || die "Failed to apply layout (POST /v2/ApplyClusterLayout)"

# ─── Verify ──────────────────────────────────────────────────────────────────
FINAL=$(garage_get "/v2/GetClusterStatus") || die "Failed to verify status"
FINAL_VER=$(echo "$FINAL" | grep -oE '"layoutVersion"[^0-9]*[0-9]+' \
    | grep -oE '[0-9]+$' || echo "?")

# ─── Done ────────────────────────────────────────────────────────────────────
touch "$INIT_FLAG"
log "==========================================="
log " Garage cluster initialised successfully!"
log "  Node     : ${NODE_ID:0:16}..."
log "  Zone     : ${ZONE}"
log "  Capacity : ${CAPACITY_GB} GB"
log "  Layout v : ${FINAL_VER}"
log "==========================================="
log "Next steps — use the Web UI or garage CLI:"
log "  garage bucket create <name>"
log "  garage key create <name>"
log "  garage bucket allow --read --write <bucket> --key <key>"

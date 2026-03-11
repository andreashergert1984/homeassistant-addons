#!/usr/bin/env bash
# init_garage.sh — First-run cluster initialisation using the Garage admin HTTP API.
# Runs once via supervisord (autorestart=false). A flag file prevents re-runs.
set -euo pipefail

INIT_FLAG="/data/garage/.cluster_initialized"
MAX_WAIT=90
POLL_INTERVAL=3

ADMIN_PORT="${GARAGE_ADMIN_PORT:-3903}"
ADMIN_TOKEN="${GARAGE_ADMIN_TOKEN:-changeme123}"
ADMIN_URL="http://127.0.0.1:${ADMIN_PORT}"
ZONE="${GARAGE_NODE_ZONE:-dc1}"
CAPACITY_GB="${GARAGE_NODE_CAPACITY_GB:-100}"
# Capacity in bytes (SI: 1 GB = 1,000,000,000 bytes)
CAPACITY_BYTES=$(( CAPACITY_GB * 1000000000 ))

log()  { echo "[init_garage] $*"; }
die()  { echo "[init_garage] ERROR: $*" >&2; exit 1; }

# ─── Already initialised? ────────────────────────────────────────────────────
if [ -f "$INIT_FLAG" ]; then
    log "Cluster already initialised (${INIT_FLAG}). Nothing to do."
    exit 0
fi

# ─── Wait for admin API ───────────────────────────────────────────────────────
log "Waiting for Garage admin API at ${ADMIN_URL} (up to ${MAX_WAIT}s)..."
WAITED=0
until curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
           "${ADMIN_URL}/v1/status" >/dev/null 2>&1; do
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        die "Garage admin API not ready after ${MAX_WAIT}s."
    fi
    sleep "$POLL_INTERVAL"
    WAITED=$(( WAITED + POLL_INTERVAL ))
done
log "Admin API ready after ${WAITED}s."

# ─── Check if layout already applied ─────────────────────────────────────────
STATUS=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" "${ADMIN_URL}/v1/status")
LAYOUT_VER=$(echo "$STATUS" | grep -oE '"layoutVersion":[0-9]+' | grep -oE '[0-9]+$' || echo "0")

if [ "${LAYOUT_VER}" -gt 0 ]; then
    log "Layout already at version ${LAYOUT_VER}. Marking as initialised."
    touch "$INIT_FLAG"
    exit 0
fi

# ─── Get node ID ─────────────────────────────────────────────────────────────
NODE_ID=$(echo "$STATUS" | grep -oE '"id":"[0-9a-f]+"' | head -1 | grep -oE '[0-9a-f]{32,}')

if [ -z "$NODE_ID" ]; then
    die "Could not determine node ID from admin API response."
fi
log "Node ID: ${NODE_ID}"
log "Zone: ${ZONE} | Capacity: ${CAPACITY_GB} GB (${CAPACITY_BYTES} bytes)"

# ─── Stage layout assignment ─────────────────────────────────────────────────
log "Staging layout assignment..."
STAGE_RESP=$(curl -sf -X POST \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "[{\"id\":\"${NODE_ID}\",\"zone\":\"${ZONE}\",\"capacity\":${CAPACITY_BYTES},\"tags\":[]}]" \
    "${ADMIN_URL}/v1/layout")
log "Staged: $(echo "$STAGE_RESP" | grep -o '"stagedRoleChanges":\[[^]]*\]' || echo "$STAGE_RESP")"

# ─── Determine next layout version ───────────────────────────────────────────
LAYOUT=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" "${ADMIN_URL}/v1/layout")
CURRENT_VER=$(echo "$LAYOUT" | grep -oE '"version":[0-9]+' | head -1 | grep -oE '[0-9]+$' || echo "0")
NEXT_VER=$(( CURRENT_VER + 1 ))

# ─── Apply layout ────────────────────────────────────────────────────────────
log "Applying layout version ${NEXT_VER}..."
curl -sf -X POST \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"version\":${NEXT_VER}}" \
    "${ADMIN_URL}/v1/layout/apply" >/dev/null

# ─── Verify ──────────────────────────────────────────────────────────────────
FINAL=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" "${ADMIN_URL}/v1/status")
FINAL_VER=$(echo "$FINAL" | grep -oE '"layoutVersion":[0-9]+' | grep -oE '[0-9]+$' || echo "?")
log "Layout version after apply: ${FINAL_VER}"

# ─── Done ────────────────────────────────────────────────────────────────────
touch "$INIT_FLAG"
log "==========================================="
log " Garage cluster initialised successfully!"
log "  Node     : ${NODE_ID:0:16}..."
log "  Zone     : ${ZONE}"
log "  Capacity : ${CAPACITY_GB} GB"
log "  Layout v : ${FINAL_VER}"
log "==========================================="
log ""
log "Next steps — use the Web UI or garage CLI:"
log "  garage bucket create <name>"
log "  garage key create <name>"
log "  garage bucket allow --read --write <bucket> --key <key>"

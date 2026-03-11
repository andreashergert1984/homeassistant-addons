#!/usr/bin/env bash
# init_garage.sh — First-run cluster initialisation for a single-node Garage instance.
# Runs once via supervisord (autorestart=false). Uses a flag file so it is
# a no-op on subsequent container starts.
set -euo pipefail

GARAGE="/usr/local/bin/garage -c /etc/garage.toml"
INIT_FLAG="/data/garage/.cluster_initialized"
MAX_WAIT=90    # seconds to wait for Garage to become reachable
POLL_INTERVAL=3

# ─── Helper ───────────────────────────────────────────────────────────────────
log()  { echo "[init_garage] $*"; }
warn() { echo "[init_garage] WARNING: $*" >&2; }
die()  { echo "[init_garage] ERROR: $*" >&2; exit 1; }

# ─── Already initialised? ────────────────────────────────────────────────────
if [ -f "$INIT_FLAG" ]; then
    log "Cluster already initialised (flag: ${INIT_FLAG}). Nothing to do."
    exit 0
fi

# ─── Wait for Garage to accept requests ──────────────────────────────────────
log "Waiting for Garage to become ready (up to ${MAX_WAIT}s)..."
WAITED=0
until $GARAGE status >/dev/null 2>&1; do
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        die "Garage did not become ready within ${MAX_WAIT} seconds."
    fi
    sleep "$POLL_INTERVAL"
    WAITED=$((WAITED + POLL_INTERVAL))
done
log "Garage is ready after ${WAITED}s."

# ─── Retrieve node ID ────────────────────────────────────────────────────────
# Parse the first hex node ID from `garage status` output.
# Status lines look like:
#   abc1234567890def   hostname   ip:port   [tags]  [zone]  [capacity]
log "Retrieving node ID from 'garage status'..."
NODE_ID=$($GARAGE status 2>/dev/null \
    | grep -v -E '^(====|ID|Healthy|Warning|Error|$)' \
    | awk 'NF>=2 && $1 ~ /^[0-9a-f]{8}/ {print $1; exit}')

if [ -z "$NODE_ID" ]; then
    die "Could not determine node ID from 'garage status'. Is Garage running?"
fi
log "Using node ID: ${NODE_ID}"

# ─── Assign node to zone / capacity ─────────────────────────────────────────
ZONE="${GARAGE_NODE_ZONE:-dc1}"
CAPACITY="${GARAGE_NODE_CAPACITY_GB:-100}"

log "Assigning node: zone=${ZONE}, capacity=${CAPACITY}G"
$GARAGE layout assign \
    --zone     "$ZONE"       \
    --capacity "${CAPACITY}G" \
    "$NODE_ID"

# ─── Apply layout ────────────────────────────────────────────────────────────
# Determine the next layout version (current + 1, or 1 on fresh install).
CURRENT_VERSION=$($GARAGE layout show 2>/dev/null \
    | grep -oE 'version [0-9]+' | grep -oE '[0-9]+' | tail -1 || echo "0")
NEXT_VERSION=$(( CURRENT_VERSION + 1 ))

log "Applying cluster layout version ${NEXT_VERSION} (current: ${CURRENT_VERSION})..."
$GARAGE layout apply --version "$NEXT_VERSION"

# ─── Verify ──────────────────────────────────────────────────────────────────
log "Verifying cluster status..."
$GARAGE status

# ─── Done ────────────────────────────────────────────────────────────────────
touch "$INIT_FLAG"
log "==========================================="
log " Garage cluster initialised successfully!"
log "  Node     : ${NODE_ID}"
log "  Zone     : ${ZONE}"
log "  Capacity : ${CAPACITY} GB"
log "==========================================="
log ""
log "Next steps (optional, via Web UI or garage CLI):"
log "  1. Create a bucket : garage bucket create <name>"
log "  2. Create an S3 key: garage key create <name>"
log "  3. Allow access    : garage bucket allow --read --write <bucket> --key <key>"

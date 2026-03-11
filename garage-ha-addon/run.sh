#!/usr/bin/env bash
# run.sh — Entrypoint for the Garage S3 Home Assistant add-on.
# Reads options.json, generates garage.toml, writes a supervisord config,
# and starts all services.
set -euo pipefail

OPTIONS_FILE="/data/options.json"
STATE_DIR="/data/garage"
SECRET_FILE="${STATE_DIR}/.rpc_secret"
GARAGE_CFG="/etc/garage.toml"
SUPERVISOR_CFG="/run/supervisor/garage-addon.conf"

# ─── Read add-on options ──────────────────────────────────────────────────────
echo "[run.sh] Reading Home Assistant add-on options..."

ADMIN_TOKEN=$(jq -r '.admin_token       // "changeme123"' "$OPTIONS_FILE")
RPC_SECRET=$(jq -r  '.rpc_secret        // ""'            "$OPTIONS_FILE")
S3_REGION=$(jq -r   '.s3_region         // "garage"'      "$OPTIONS_FILE")
DATA_BASE=$(jq -r   '.data_base         // "media"'       "$OPTIONS_FILE")
DATA_PATH=$(jq -r   '.data_path         // "garage"'      "$OPTIONS_FILE")
S3_PORT=$(jq -r     '.s3_port           // 3900'          "$OPTIONS_FILE")
ADMIN_PORT=$(jq -r  '.admin_port        // 3903'          "$OPTIONS_FILE")
WEBUI_PORT=$(jq -r  '.webui_port        // 3909'          "$OPTIONS_FILE")
WEBUI_ENABLED=$(jq -r '.webui_enabled   // true'          "$OPTIONS_FILE")
NODE_ZONE=$(jq -r   '.node_zone         // "dc1"'         "$OPTIONS_FILE")
NODE_CAPACITY_GB=$(jq -r '.node_capacity_gb // 100'       "$OPTIONS_FILE")
COMPRESSION_LEVEL=$(jq -r '.compression_level // 1'       "$OPTIONS_FILE")
LOG_LEVEL=$(jq -r   '.log_level         // "info"'        "$OPTIONS_FILE")

# ─── Determine storage paths ─────────────────────────────────────────────────
if [ "$DATA_BASE" = "media" ]; then
    BASE_DIR="/media"
else
    BASE_DIR="/data"
fi

STORAGE_DIR="${BASE_DIR}/${DATA_PATH}"
META_DIR="${STORAGE_DIR}/meta"
DATA_DIR="${STORAGE_DIR}/data"

echo "[run.sh] Creating storage directories: $META_DIR, $DATA_DIR"
mkdir -p "$META_DIR" "$DATA_DIR" "$STATE_DIR"

# ─── RPC secret management ───────────────────────────────────────────────────
# Priority: 1) user-provided in options  2) previously stored  3) auto-generate
if [ -n "$RPC_SECRET" ] && [ ${#RPC_SECRET} -eq 64 ]; then
    echo "[run.sh] Using RPC secret from options."
    echo "$RPC_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
elif [ -f "$SECRET_FILE" ] && [ -s "$SECRET_FILE" ]; then
    RPC_SECRET=$(cat "$SECRET_FILE")
    echo "[run.sh] Using stored RPC secret."
else
    RPC_SECRET=$(openssl rand -hex 32)
    echo "$RPC_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "[run.sh] Generated new RPC secret (stored in ${SECRET_FILE})."
fi

# ─── Build garage.toml from template ─────────────────────────────────────────
if [ "$COMPRESSION_LEVEL" -eq 0 ] 2>/dev/null; then
    COMPRESSION_LINE="# compression disabled"
else
    COMPRESSION_LINE="compression_level = ${COMPRESSION_LEVEL}"
fi

echo "[run.sh] Writing ${GARAGE_CFG}..."
sed \
    -e "s|@@META_DIR@@|${META_DIR}|g"                   \
    -e "s|@@DATA_DIR@@|${DATA_DIR}|g"                   \
    -e "s|@@RPC_SECRET@@|${RPC_SECRET}|g"               \
    -e "s|@@S3_REGION@@|${S3_REGION}|g"                 \
    -e "s|@@S3_PORT@@|${S3_PORT}|g"                     \
    -e "s|@@ADMIN_PORT@@|${ADMIN_PORT}|g"               \
    -e "s|@@ADMIN_TOKEN@@|${ADMIN_TOKEN}|g"             \
    -e "s|@@COMPRESSION_LINE@@|${COMPRESSION_LINE}|g"   \
    /etc/garage.toml.tmpl > "$GARAGE_CFG"

# ─── Export env vars for supervisord child processes ─────────────────────────
export GARAGE_ADMIN_TOKEN="$ADMIN_TOKEN"
export GARAGE_ADMIN_PORT="$ADMIN_PORT"
export GARAGE_ENDPOINT="http://127.0.0.1:${ADMIN_PORT}"
export GARAGE_LOG_LEVEL="$LOG_LEVEL"
export GARAGE_NODE_ZONE="$NODE_ZONE"
export GARAGE_NODE_CAPACITY_GB="$NODE_CAPACITY_GB"
export GARAGE_S3_PORT="$S3_PORT"
export GARAGE_WEBUI_PORT="$WEBUI_PORT"

# ─── Discover Garage Web UI binary ───────────────────────────────────────────
WEBUI_BIN=""
if [ "$WEBUI_ENABLED" = "true" ]; then
    for candidate in \
            /usr/local/bin/garage-webui \
            /app/server \
            /server \
            /app/garage-webui; do
        if [ -x "$candidate" ]; then
            WEBUI_BIN="$candidate"
            echo "[run.sh] Found garage-webui binary: ${WEBUI_BIN}"
            break
        fi
    done
    if [ -z "$WEBUI_BIN" ]; then
        echo "[run.sh] WARNING: garage-webui binary not found. Web UI will be disabled."
        WEBUI_ENABLED="false"
    fi
fi

# ─── Generate supervisord configuration ──────────────────────────────────────
mkdir -p /run/supervisor
cat > "$SUPERVISOR_CFG" << SUPERVISORD_EOF
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0
pidfile=/run/supervisord.pid
user=root

[unix_http_server]
file=/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///run/supervisor.sock

# ── Garage server ─────────────────────────────────────────────────────────────
[program:garage]
command=/usr/local/bin/garage -c ${GARAGE_CFG} server
autostart=true
autorestart=true
startretries=5
startsecs=3
priority=10
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=RUST_LOG="${LOG_LEVEL}"

# ── First-run cluster initialisation (runs once, then exits) ─────────────────
[program:garage-init]
command=/usr/local/bin/init_garage.sh
autostart=true
autorestart=false
startretries=3
startsecs=0
priority=20
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=GARAGE_ADMIN_TOKEN="${ADMIN_TOKEN}",GARAGE_ENDPOINT="http://127.0.0.1:${ADMIN_PORT}",GARAGE_NODE_ZONE="${NODE_ZONE}",GARAGE_NODE_CAPACITY_GB="${NODE_CAPACITY_GB}"
SUPERVISORD_EOF

# Append Web UI block only when enabled
if [ "$WEBUI_ENABLED" = "true" ] && [ -n "$WEBUI_BIN" ]; then
    cat >> "$SUPERVISOR_CFG" << WEBUI_EOF

# ── Garage Web UI ─────────────────────────────────────────────────────────────
[program:garage-webui]
command=${WEBUI_BIN}
autostart=true
autorestart=true
startretries=3
startsecs=5
priority=30
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=GARAGE_ENDPOINT="http://127.0.0.1:${ADMIN_PORT}",GARAGE_ADMIN_TOKEN="${ADMIN_TOKEN}",GARAGE_RPC_SECRET="${RPC_SECRET}",PORT="${WEBUI_PORT}",LISTEN_ADDR="0.0.0.0:${WEBUI_PORT}",LISTEN_PORT="${WEBUI_PORT}"
WEBUI_EOF
    echo "[run.sh] Web UI enabled on port ${WEBUI_PORT}"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo " Garage S3 Object Storage — starting"
echo "================================================"
echo "  Storage path : ${STORAGE_DIR}"
echo "  S3 API port  : ${S3_PORT}"
echo "  Admin port   : ${ADMIN_PORT}  (loopback only)"
echo "  Web UI port  : ${WEBUI_PORT}  (enabled: ${WEBUI_ENABLED})"
echo "  S3 region    : ${S3_REGION}"
echo "  Node zone    : ${NODE_ZONE}   capacity: ${NODE_CAPACITY_GB} GB"
echo "  Log level    : ${LOG_LEVEL}"
echo "================================================"
echo ""

# ─── Hand off to supervisord ─────────────────────────────────────────────────
exec /usr/bin/supervisord -n -c "$SUPERVISOR_CFG"

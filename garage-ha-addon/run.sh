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
DB_ENGINE=$(jq -r   '.db_engine         // "sqlite"'      "$OPTIONS_FILE")
RESET_METADATA=$(jq -r '.reset_metadata // false'         "$OPTIONS_FILE")
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

# ─── Metadata reset (corruption recovery) ────────────────────────────────────
if [ "$RESET_METADATA" = "true" ]; then
    echo "[run.sh] WARNING: reset_metadata=true — wiping metadata directory and init flag."
    echo "[run.sh]   Meta dir : $META_DIR"
    echo "[run.sh]   Object data in $DATA_DIR is NOT deleted."
    rm -rf "$META_DIR"
    mkdir -p "$META_DIR"
    rm -f "${STATE_DIR}/.cluster_initialized"
    echo "[run.sh] Metadata wiped. You will need to recreate buckets and access keys."
    # Clear the flag in options.json so it doesn't wipe again on next restart
    if jq -e '.reset_metadata' "$OPTIONS_FILE" >/dev/null 2>&1; then
        tmp=$(mktemp)
        jq '.reset_metadata = false' "$OPTIONS_FILE" > "$tmp" && mv "$tmp" "$OPTIONS_FILE"
        echo "[run.sh] reset_metadata reset to false in options.json."
    fi
fi

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
    -e "s|@@DB_ENGINE@@|${DB_ENGINE}|g"                 \
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

# ─── Resolve HA ingress path ─────────────────────────────────────────────────
# Query the supervisor API to get the ingress path. nginx will use sub_filter
# to inject this into the HTML so the React app can resolve all asset and API
# URLs correctly through the HA ingress proxy.
INGRESS_PATH=""
if [ -n "${SUPERVISOR_TOKEN:-}" ]; then
    INGRESS_URL=$(curl -sf --max-time 5 \
        -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" \
        "http://supervisor/addons/self/info" \
        | jq -r '.data.ingress_url // empty' 2>/dev/null || true)
    if [ -n "$INGRESS_URL" ]; then
        INGRESS_PATH="${INGRESS_URL%/}"   # strip trailing slash
        echo "[run.sh] HA ingress path: ${INGRESS_PATH}"
    else
        echo "[run.sh] Supervisor token present but no ingress URL — direct port mode."
    fi
else
    echo "[run.sh] No SUPERVISOR_TOKEN — running outside HA (direct port access)."
fi

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

# Append Web UI + nginx blocks only when enabled
WEBUI_INTERNAL_PORT="3919"
if [ "$WEBUI_ENABLED" = "true" ] && [ -n "$WEBUI_BIN" ]; then
    # ── Generate nginx config ─────────────────────────────────────────────────
    # nginx listens on the public WebUI port and proxies to the internal port.
    # sub_filter rewrites the HTML so the React app resolves asset/API URLs
    # through the HA ingress prefix (or works unchanged for direct port access).
    mkdir -p /run/nginx
    cat > /run/nginx/nginx.conf << NGINX_EOF
worker_processes 1;
error_log /dev/stderr warn;
pid /run/nginx/nginx.pid;
daemon off;

events { worker_connections 256; }

http {
    access_log off;

    server {
        listen ${WEBUI_PORT};

        location / {
            proxy_pass         http://127.0.0.1:${WEBUI_INTERNAL_PORT};
            proxy_set_header   Host \$host;
            proxy_set_header   X-Real-IP \$remote_addr;
            proxy_http_version 1.1;
            proxy_read_timeout 60s;

            # Prevent upstream compression so sub_filter can rewrite HTML
            proxy_set_header   Accept-Encoding "";

            # Inject the HA ingress path into the React app's base URL and
            # rewrite all absolute asset paths so they resolve through ingress.
            sub_filter_once off;
            sub_filter 'window.__BASE_PATH = ""' 'window.__BASE_PATH = "${INGRESS_PATH}"';
            sub_filter 'src="/'  'src="${INGRESS_PATH}/';
            sub_filter 'href="/' 'href="${INGRESS_PATH}/';
        }
    }
}
NGINX_EOF

    cat >> "$SUPERVISOR_CFG" << WEBUI_EOF

# ── Garage Web UI (internal, proxied by nginx) ────────────────────────────────
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
environment=API_BASE_URL="http://127.0.0.1:${ADMIN_PORT}",API_ADMIN_KEY="${ADMIN_TOKEN}",CONFIG_PATH="/etc/garage.toml",S3_REGION="${S3_REGION}",S3_ENDPOINT_URL="http://127.0.0.1:${S3_PORT}",PORT="${WEBUI_INTERNAL_PORT}",HOST="127.0.0.1"

# ── nginx reverse proxy (public Web UI port, handles ingress rewriting) ────────
[program:nginx]
command=/usr/sbin/nginx -c /run/nginx/nginx.conf
autostart=true
autorestart=true
startretries=3
startsecs=3
priority=35
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
WEBUI_EOF
    echo "[run.sh] Web UI enabled on port ${WEBUI_PORT} (nginx → internal :${WEBUI_INTERNAL_PORT})"
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
echo "  Ingress path : ${INGRESS_PATH:-(none, direct port access)}"
echo "  S3 region    : ${S3_REGION}"
echo "  Node zone    : ${NODE_ZONE}   capacity: ${NODE_CAPACITY_GB} GB"
echo "  Log level    : ${LOG_LEVEL}"
echo "================================================"
echo ""

# ─── Hand off to supervisord ─────────────────────────────────────────────────
exec /usr/bin/supervisord -n -c "$SUPERVISOR_CFG"

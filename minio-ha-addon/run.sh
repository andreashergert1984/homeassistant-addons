#!/usr/bin/env bash
set -e


# Default values (can be overridden by Home Assistant options)
MINIO_ROOT_USER="${MINIO_ROOT_USER:-admin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minio123}"
MINIO_DATA_PATH="minio"
MINIO_DATA_BASE="media"
MINIO_BROWSER="${MINIO_BROWSER:-on}"
MINIO_CONSOLE_ADDRESS="${MINIO_CONSOLE_ADDRESS:-:9001}"


# Read Home Assistant options if available
API_PORT=9000
CONSOLE_PORT=9001
if [ -f /data/options.json ]; then
    echo "Reading Home Assistant add-on options..."
    if command -v jq &> /dev/null; then
        ADMIN_USER=$(jq -r '.admin_user // "admin"' /data/options.json)
        ADMIN_PASSWORD=$(jq -r '.admin_password // "minio123"' /data/options.json)
        DATA_PATH=$(jq -r '.data_path // "minio"' /data/options.json)
        DATA_BASE=$(jq -r '.data_base // "media"' /data/options.json)
        BROWSER_ENABLED=$(jq -r '.browser_enabled // true' /data/options.json)
        API_PORT=$(jq -r '.api_port // 9000' /data/options.json)
        CONSOLE_PORT=$(jq -r '.console_port // 9001' /data/options.json)
        export MINIO_ROOT_USER="$ADMIN_USER"
        export MINIO_ROOT_PASSWORD="$ADMIN_PASSWORD"
        MINIO_DATA_PATH="$DATA_PATH"
        MINIO_DATA_BASE="$DATA_BASE"
        if [ "$BROWSER_ENABLED" = "false" ]; then
            export MINIO_BROWSER="off"
        fi
    fi
fi

# Determine full data directory
if [ "$MINIO_DATA_BASE" = "media" ]; then
    MINIO_DATA_DIR="/media/${MINIO_DATA_PATH}"
else
    MINIO_DATA_DIR="/data/${MINIO_DATA_PATH}"
fi

# Ensure data directory exists
mkdir -p "$MINIO_DATA_DIR"

echo "================================================"
echo "Starting MinIO Server"
echo "Data directory: $MINIO_DATA_DIR"
echo "Admin user: $MINIO_ROOT_USER"
echo "Console enabled: $MINIO_BROWSER"
echo "API Port: $API_PORT"
echo "Console Port: $CONSOLE_PORT"
echo "================================================"

# Start MinIO server
exec minio server "$MINIO_DATA_DIR" \
    --address ":$API_PORT" \
    --console-address ":$CONSOLE_PORT"

#!/usr/bin/env bash
set -e

# Default values (can be overridden by Home Assistant options)
MINIO_ROOT_USER="${MINIO_ROOT_USER:-admin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minio123}"
MINIO_DATA_DIR="${MINIO_DATA_DIR:-/data/minio}"
MINIO_BROWSER="${MINIO_BROWSER:-on}"
MINIO_CONSOLE_ADDRESS="${MINIO_CONSOLE_ADDRESS:-:9001}"

# Read Home Assistant options if available
if [ -f /data/options.json ]; then
    echo "Reading Home Assistant add-on options..."
    
    # Use jq to parse options if available, otherwise use defaults
    if command -v jq &> /dev/null; then
        ADMIN_USER=$(jq -r '.admin_user // "admin"' /data/options.json)
        ADMIN_PASSWORD=$(jq -r '.admin_password // "minio123"' /data/options.json)
        DATA_PATH=$(jq -r '.data_path // "minio"' /data/options.json)
        BROWSER_ENABLED=$(jq -r '.browser_enabled // true' /data/options.json)
        
        # Set MinIO environment variables from options
        export MINIO_ROOT_USER="$ADMIN_USER"
        export MINIO_ROOT_PASSWORD="$ADMIN_PASSWORD"
        export MINIO_DATA_DIR="/data/${DATA_PATH}"
        
        if [ "$BROWSER_ENABLED" = "false" ]; then
            export MINIO_BROWSER="off"
        fi
    fi
fi

# Ensure data directory exists
mkdir -p "$MINIO_DATA_DIR"

echo "================================================"
echo "Starting MinIO Server"
echo "Data directory: $MINIO_DATA_DIR"
echo "Admin user: $MINIO_ROOT_USER"
echo "Console enabled: $MINIO_BROWSER"
echo "API Port: 9000"
echo "Console Port: 9001"
echo "================================================"

# Start MinIO server
exec minio server "$MINIO_DATA_DIR" \
    --address ":9000" \
    --console-address "$MINIO_CONSOLE_ADDRESS"

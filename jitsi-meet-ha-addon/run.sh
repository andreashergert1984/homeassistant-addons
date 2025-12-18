#!/bin/bash
set -e

CONFIG_PATH="/data/options.json"

echo "===== Jitsi Meet Add-on Starting ====="

# Read options from Home Assistant (for future customization)
if [ -f "$CONFIG_PATH" ]; then
    PUBLIC_URL=$(jq -r '.public_url // "http://localhost:8000"' "$CONFIG_PATH")
    echo "PUBLIC_URL: $PUBLIC_URL"
fi

echo "Starting Nginx web server..."
echo "Access Jitsi Meet at http://<your-ha-ip>:8000"

# Start nginx
exec nginx -g 'daemon off;'

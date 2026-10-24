#!/bin/sh
# Entrypoint of the Yuvomi Home Assistant add-on.
# Reads /data/options.json, creates the secrets once, then hands over to the
# upstream entrypoint (fixes volume permissions, drops to the node user).
set -eu

OPTIONS=/data/options.json
SECRETS=/data/secrets.env
BASE=/share/yuvomi

opt() {
    node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1]));const v=o[process.argv[2]];process.stdout.write(v==null?"":String(v))' "$OPTIONS" "$1"
}

# Secrets are generated on first start and persist in /data (part of HA backups).
# DB_ENCRYPTION_KEY must never change, or the database can no longer be opened.
if [ ! -s "$SECRETS" ]; then
    echo "[yuvomi] Generating session secret and database encryption key"
    umask 077
    {
        echo "SESSION_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("hex"))')"
        echo "DB_ENCRYPTION_KEY=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
    } > "$SECRETS"
fi
set -a
. "$SECRETS"
set +a

mkdir -p "$BASE/backups" "$BASE/documents"
chown -R node:node "$BASE"

export NODE_ENV=production
export PORT=3000
export DB_PATH=/data/yuvomi.db
export BACKUP_DIR="$BASE/backups"
export MODULES_DIR=/app/modules
export DOCUMENT_STORAGE_LOCAL_ENABLED=true
export DOCUMENT_STORAGE_LOCAL_PATH="$BASE/documents"
export TZ="$(opt timezone)"
export LOG_LEVEL="$(opt log_level)"
export SESSION_SECURE="$(opt session_secure)"
export TRUST_PROXY="$(opt trust_proxy)"
export WEATHER_CITY="$(opt weather_city)"
export WEATHER_LAT="$(opt weather_lat)"
export WEATHER_LON="$(opt weather_lon)"
export WEATHER_UNITS="$(opt weather_units)"

# Pantry terminal (scan page for ingress), restarted if it ever exits.
chown node:node /data
export TERMINAL_PORT=8099
export YUVOMI_URL=http://127.0.0.1:3000
export YUVOMI_API_TOKEN="$(opt api_token)"
export OFF_LOOKUP="$(opt lookup_openfoodfacts)"
( while true; do gosu node node /terminal/server.js; sleep 3; done ) &

echo "[yuvomi] Starting (data: /data, backups: $BACKUP_DIR, documents: $DOCUMENT_STORAGE_LOCAL_PATH)"
exec /entrypoint.sh "$@"

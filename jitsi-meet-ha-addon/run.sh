#!/bin/bash
set -e

CONFIG_PATH="/data/options.json"
SECRETS_FILE="/data/jitsi-secrets.env"

echo "===== Jitsi Meet Add-on Starting ====="

# ── Read options ─────────────────────────────────────────────────────────────
PUBLIC_URL=$(jq -r '.public_url // "https://meet.example.com"' "$CONFIG_PATH")
DEFAULT_ROOM=$(jq -r '.default_room // "HomeAssistant"' "$CONFIG_PATH")
ENABLE_AUTH=$(jq -r '.enable_auth // false' "$CONFIG_PATH")
ENABLE_GUESTS=$(jq -r '.enable_guests // true' "$CONFIG_PATH")
ENABLE_RECORDING=$(jq -r '.enable_recording // false' "$CONFIG_PATH")
JVB_ADVERTISE_HOST=$(jq -r '.jvb_advertise_host // ""' "$CONFIG_PATH")
TIMEZONE=$(jq -r '.timezone // "Europe/Berlin"' "$CONFIG_PATH")

# Derive XMPP domain from PUBLIC_URL (strip scheme and trailing slash)
XMPP_DOMAIN=$(echo "$PUBLIC_URL" | sed 's|https\?://||;s|/.*||')
echo "XMPP_DOMAIN: $XMPP_DOMAIN"

# ── Resolve JVB advertise address (supports hostname/DDNS or plain IP) ─────────
JVB_ADVERTISE_IP=""
if [ -n "$JVB_ADVERTISE_HOST" ]; then
    # Try to resolve hostname to IP; fall back to using value as-is if it looks like an IP
    RESOLVED=$(getent hosts "$JVB_ADVERTISE_HOST" 2>/dev/null | awk '{print $1}' | head -1)
    if [ -n "$RESOLVED" ]; then
        JVB_ADVERTISE_IP="$RESOLVED"
        echo "JVB advertise: resolved $JVB_ADVERTISE_HOST -> $JVB_ADVERTISE_IP"
    else
        echo "WARNING: Could not resolve $JVB_ADVERTISE_HOST — JVB NAT traversal may not work for remote participants"
    fi
fi

# ── Timezone ─────────────────────────────────────────────────────────────────
if [ -f "/usr/share/zoneinfo/$TIMEZONE" ]; then
    ln -sf "/usr/share/zoneinfo/$TIMEZONE" /etc/localtime
    echo "$TIMEZONE" > /etc/timezone
fi

# ── Generate or load persistent secrets ──────────────────────────────────────
if [ ! -f "$SECRETS_FILE" ]; then
    echo "Generating new shared secrets..."
    JVB_SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
    JVB_AUTH_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
    JICOFO_AUTH_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
    JICOFO_COMPONENT_SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
    TURN_SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
    cat > "$SECRETS_FILE" <<EOF
JVB_SECRET=${JVB_SECRET}
JVB_AUTH_PASSWORD=${JVB_AUTH_PASSWORD}
JICOFO_AUTH_PASSWORD=${JICOFO_AUTH_PASSWORD}
JICOFO_COMPONENT_SECRET=${JICOFO_COMPONENT_SECRET}
TURN_SECRET=${TURN_SECRET}
EOF
    chmod 600 "$SECRETS_FILE"
else
    echo "Loading existing secrets..."
    # shellcheck disable=SC1090
    source "$SECRETS_FILE"
    # Migrate: add JICOFO_COMPONENT_SECRET if missing from old secrets file
    if [ -z "$JICOFO_COMPONENT_SECRET" ]; then
        echo "Migrating secrets: adding JICOFO_COMPONENT_SECRET..."
        JICOFO_COMPONENT_SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
        echo "JICOFO_COMPONENT_SECRET=${JICOFO_COMPONENT_SECRET}" >> "$SECRETS_FILE"
    fi
fi

# ── Prosody data directory & self-signed certs ──────────────────────────────
mkdir -p /data/prosody/certs /data/logs /data/recordings

# Generate self-signed certs if not present (NPM provides the real TLS upstream)
for certdomain in "$XMPP_DOMAIN" "auth.$XMPP_DOMAIN"; do
    CERTDIR="/data/prosody/certs"
    if [ ! -f "$CERTDIR/${certdomain}.crt" ]; then
        echo "Generating self-signed cert for $certdomain ..."
        openssl req -x509 -newkey rsa:2048 -days 3650 -nodes \
            -keyout "$CERTDIR/${certdomain}.key" \
            -out "$CERTDIR/${certdomain}.crt" \
            -subj "/CN=${certdomain}" 2>/dev/null
    fi
done

# ── Prosody config ────────────────────────────────────────────────────────────
if [ "$ENABLE_AUTH" = "true" ]; then
    XMPP_AUTH="internal_plain"
    if [ "$ENABLE_GUESTS" = "true" ]; then
        GUEST_VHOST_BLOCK="VirtualHost \"guest.${XMPP_DOMAIN}\"
    authentication = \"anonymous\"
    c2s_require_encryption = false"
    else
        GUEST_VHOST_BLOCK=""
    fi
else
    XMPP_AUTH="anonymous"
    GUEST_VHOST_BLOCK=""
fi

export XMPP_DOMAIN XMPP_AUTH GUEST_VHOST_BLOCK JVB_SECRET JVB_AUTH_PASSWORD \
       JICOFO_AUTH_PASSWORD JICOFO_COMPONENT_SECRET TURN_SECRET DEFAULT_ROOM ENABLE_AUTH ENABLE_GUESTS

envsubst < /etc/jitsi/meet/prosody.cfg.lua.tmpl > /etc/prosody/prosody.cfg.lua
echo "Prosody config written."

# ── Jicofo config ─────────────────────────────────────────────────────────────
mkdir -p /etc/jitsi/jicofo
envsubst < /etc/jitsi/jicofo/jicofo.conf.tmpl > /etc/jitsi/jicofo/jicofo.conf
echo "Jicofo config written."

# ── JVB config ────────────────────────────────────────────────────────────────
mkdir -p /etc/jitsi/videobridge

envsubst < /etc/jitsi/videobridge/jvb.conf.tmpl > /etc/jitsi/videobridge/jvb.conf
echo "JVB config written."

# ── JVB sip-communicator.properties (NAT harvester + disable AWS lookup) ─────
# JVB's legacyConfig reads this from /etc/jitsi/videobridge/sip-communicator.properties
SCP_PROPS="/etc/jitsi/videobridge/sip-communicator.properties"
cat > "$SCP_PROPS" <<EOF
org.ice4j.ice.harvest.DISABLE_AWS_HARVESTER=true
EOF
if [ -n "$JVB_ADVERTISE_IP" ]; then
    LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
    LOCAL_IP="${LOCAL_IP:-0.0.0.0}"
    echo "org.ice4j.harvest.NAT_HARVESTER_LOCAL_ADDRESS=${LOCAL_IP}" >> "$SCP_PROPS"
    echo "org.ice4j.harvest.NAT_HARVESTER_PUBLIC_ADDRESS=${JVB_ADVERTISE_IP}" >> "$SCP_PROPS"
    echo "JVB NAT harvester: ${LOCAL_IP} -> ${JVB_ADVERTISE_IP}"
else
    echo "JVB NAT harvester not configured (jvb_advertise_host not set)"
fi

# ── Jitsi Meet web config.js ─────────────────────────────────────────────────
# Lower-case boolean for JS
RECORDING_ENABLED=$(echo "$ENABLE_RECORDING" | tr '[:upper:]' '[:lower:]')
export RECORDING_ENABLED

JITSI_WEB_ROOT=$(find /usr/share -maxdepth 1 -name 'jitsi-meet' 2>/dev/null | head -1)
JITSI_WEB_ROOT="${JITSI_WEB_ROOT:-/usr/share/jitsi-meet}"

envsubst < /etc/jitsi/meet/config.js.tmpl > "${JITSI_WEB_ROOT}/config.js"
echo "config.js written to ${JITSI_WEB_ROOT}/config.js"

# ── head.html — inject critical scripts via SSI ───────────────────────────────
# Jitsi's index.html uses <!--#include virtual="head.html"--> (SSI) to load
# config.js, interface_config.js, utils.js and do_external_connect.js.
# Without this the app renders a black page.
cat > "${JITSI_WEB_ROOT}/head.html" <<'HEADHTML'
<script src="config.js"></script>
<script src="interface_config.js"></script>
<script src="utils.js"></script>
<script src="do_external_connect.js"></script>
HEADHTML
echo "head.html written."

# Create minimal stubs for optional JS files that may not be included by the
# Jitsi package (modern builds bundle these into app.bundle.min.js).
# Without them, nginx's SPA fallback serves index.html as text/html, which
# the browser then tries to parse as JS causing "Unexpected token '<'" errors.
[ -f "${JITSI_WEB_ROOT}/utils.js" ] || echo '/* utils stub */' > "${JITSI_WEB_ROOT}/utils.js"
[ -f "${JITSI_WEB_ROOT}/do_external_connect.js" ] || echo '/* do_external_connect stub */' > "${JITSI_WEB_ROOT}/do_external_connect.js"
echo "JS stubs checked."

# ── Nginx site config ─────────────────────────────────────────────────────────
# Remove default site, write Jitsi site
rm -f /etc/nginx/conf.d/default.conf /etc/nginx/sites-enabled/default 2>/dev/null || true
envsubst '${XMPP_DOMAIN}' < /etc/nginx/conf.d/jitsi.conf.tmpl > /etc/nginx/conf.d/jitsi.conf
# Update nginx root to match installed path
sed -i "s|root /usr/share/jitsi-meet|root ${JITSI_WEB_ROOT}|" /etc/nginx/conf.d/jitsi.conf
echo "Nginx config written."

# ── Prosody: register jicofo and jvb accounts ─────────────────────────────────
# Ensure prosody data dirs have correct ownership
chown -R prosody:prosody /data/prosody

# Build the registration script — wait for Prosody TCP port, then register
cat > /usr/local/bin/register-jitsi-users.sh <<REGSCRIPT
#!/bin/bash
echo "[register-users] Waiting for Prosody port 5222..."
for i in \$(seq 1 30); do
    if bash -c "echo >/dev/tcp/127.0.0.1/5222" 2>/dev/null; then
        echo "[register-users] Prosody is up after \${i}s"
        break
    fi
    sleep 1
done
sleep 2  # extra settle time

echo "[register-users] Registering focus@auth.${XMPP_DOMAIN}"
prosodyctl register focus "auth.${XMPP_DOMAIN}" "${JICOFO_AUTH_PASSWORD}" && \
    echo "[register-users] focus registered OK" || \
    echo "[register-users] focus registration failed (may already exist)"

echo "[register-users] Registering jvb@auth.${XMPP_DOMAIN}"
prosodyctl register jvb "auth.${XMPP_DOMAIN}" "${JVB_AUTH_PASSWORD}" && \
    echo "[register-users] jvb registered OK" || \
    echo "[register-users] jvb registration failed (may already exist)"
REGSCRIPT
chmod +x /usr/local/bin/register-jitsi-users.sh

# ── Detect Jicofo startup command ─────────────────────────────────────────────
JICOFO_CMD=""
for candidate in /usr/bin/jicofo /usr/share/jicofo/jicofo.sh /usr/share/jicofo/launch.sh; do
    if [ -x "$candidate" ]; then
        JICOFO_CMD="$candidate"
        break
    fi
done
if [ -z "$JICOFO_CMD" ]; then
    # Try java -jar as last resort
    JICOFO_JAR=$(find /usr/share/jicofo -name 'jicofo*.jar' 2>/dev/null | head -1)
    if [ -n "$JICOFO_JAR" ]; then
        JICOFO_CMD="java -jar ${JICOFO_JAR} --host=127.0.0.1 --domain=auth.${XMPP_DOMAIN} --user_domain=auth.${XMPP_DOMAIN}"
    else
        echo "WARNING: Jicofo startup command not found - conference allocation will not work!"
        JICOFO_CMD="/bin/true"
    fi
fi
echo "Jicofo command: ${JICOFO_CMD}"

# Write the detected command into supervisord config
sed -i "s|command=/usr/share/jicofo/jicofo.sh|command=${JICOFO_CMD}|" /etc/supervisor/conf.d/jitsi.conf

# Add user registration as a supervisor one-shot program
cat >> /etc/supervisor/conf.d/jitsi.conf <<EOF

[program:register-users]
command=/usr/local/bin/register-jitsi-users.sh
autostart=true
autorestart=false
priority=15
startsecs=0
stdout_logfile=/data/logs/register-users.log
stderr_logfile=/data/logs/register-users.log
EOF

echo "===== Starting all Jitsi services via supervisord ====="
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/jitsi.conf


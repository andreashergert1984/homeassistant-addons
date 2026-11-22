#!/bin/sh
# Entrypoint of the Hausmeister add-on.
set -eu

mkdir -p /data/home /data/work /share/hausmeister/tickets

# Time zone of Home Assistant, so the schedule matches the house.
TZ_HA="$(curl -sf -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" http://supervisor/info | jq -r '.data.timezone // empty' || true)"
export TZ="${TZ_HA:-Europe/Berlin}"

# Rules for Claude: CLAUDE.md in the working directory is read on every run.
cp /app/prompt/regeln.md /data/work/CLAUDE.md
[ -f /share/hausmeister/WISSEN.md ] || printf '# Wissen über dieses Haus\n\nHier hält der Hausmeister dauerhaft nützliche Fakten fest. Du kannst die Datei selbst ergänzen.\n' > /share/hausmeister/WISSEN.md

# Login terminal, only reachable through the board (ingress).
cat > /data/home/.bash_profile <<'RC'
cd /data/work
echo
echo "Hausmeister-Terminal. Anmelden: claude eingeben, dann /login. Beenden mit /exit."
echo "Helfer: ha-read, ha-api, cfg-git"
echo
RC
( while true; do ttyd -p 7681 -i 127.0.0.1 -b /terminal -W -w /data/work -d 3 -t fontSize=14 -t titleFixed=Hausmeister bash -l || true; sleep 3; done ) &

echo "[hausmeister] Zeitzone ${TZ}"
exec node /app/server.js

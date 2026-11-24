#!/bin/sh
# Entrypoint of the Hausmeister add-on.
set -eu

mkdir -p /data/home /data/work /share/hausmeister/tickets

# Time zone of Home Assistant, so the schedule matches the house.
TZ_HA="$(curl -sf -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" http://supervisor/info | jq -r '.data.timezone // empty' || true)"
export TZ="${TZ_HA:-Europe/Berlin}"

# Rules for Claude (/data/work/CLAUDE.md), the greeting of the terminal and WISSEN.md are
# written by the server in the active language (option "language", auto follows Home Assistant).

# Login terminal, only reachable through the board (ingress).
( while true; do ttyd -p 7681 -i 127.0.0.1 -b /terminal -W -w /data/work -d 3 -t fontSize=14 -t titleFixed=Hausmeister bash -l || true; sleep 3; done ) &

echo "[hausmeister] time zone ${TZ}"
exec node /app/server.js

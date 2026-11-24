#!/bin/sh
# Entrypoint of the Hausmeister add-on.
set -eu
# Files of root stay unwritable for the user hausmeister (draft, inspection).
umask 022

mkdir -p /data/home /data/work /share/hausmeister/tickets

# Time zone of Home Assistant, so the schedule matches the house.
TZ_HA="$(curl -sf -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" http://supervisor/info | jq -r '.data.timezone // empty' || true)"
export TZ="${TZ_HA:-Europe/Berlin}"

# Rules for Claude (/data/work/CLAUDE.md), the greeting of the terminal and the knowledge file
# (/data/wissen.md, exported to /share/hausmeister/WISSEN.md) are
# written by the server in the active language (option "language", auto follows Home Assistant).

# The login terminal (ttyd, only reachable through the board) is started by the server, without
# the Supervisor token. Rights for the user hausmeister (draft, inspection) are set by the server.

echo "[hausmeister] time zone ${TZ}"
exec node /app/server.js

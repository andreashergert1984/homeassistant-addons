#!/bin/bash
set -e
PORT=${PORT:-8080}
exec python3 /server.py --port "$PORT"

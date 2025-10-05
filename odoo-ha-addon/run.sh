#!/usr/bin/env bash
set -e

# Ensure the PostgreSQL data directory is owned by the postgres user
chown -R postgres:postgres "$PGDATA"

# Start Supervisor (which will start Postgres & Odoo)
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
#!/usr/bin/env bash
set -e

POSTGRES_DATA=/data/postgres
POSTGRES_BIN=/usr/lib/postgresql/13/bin/postgres
POSTGRES_INITDB=/usr/lib/postgresql/13/bin/initdb
POSTGRES_USER=odoo

# Ensure folder exists and has correct ownership
mkdir -p $POSTGRES_DATA
chown -R odoo:odoo $POSTGRES_DATA

# Initialize database if it doesn't exist
if [ ! -f "$POSTGRES_DATA/PG_VERSION" ]; then
    su - odoo -c "$POSTGRES_INITDB -D $POSTGRES_DATA --username=$POSTGRES_USER --auth=trust"
fi

# Start PostgreSQL as odoo
exec su - odoo -c "$POSTGRES_BIN -D $POSTGRES_DATA"

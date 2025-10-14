#!/usr/bin/env bash
set -e

ODOO_HOME=/opt/odoo
CONF=/etc/odoo/odoo.conf
DATA_DIR=/data
POSTGRES_USER=odoo

# Wait for PostgreSQL to be ready
until pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1; do
    echo "Waiting for PostgreSQL..."
    sleep 2
done

# Create Odoo config if missing
if [ ! -f "$CONF" ]; then
    cat > $CONF <<EOF
[options]
db_host = 127.0.0.1
db_port = 5432
db_user = $POSTGRES_USER
db_password =
admin_passwd = admin
addons_path = $ODOO_HOME/addons,$DATA_DIR/addons
xmlrpc_port = 8069
data_dir = $DATA_DIR/filestore
logfile = $DATA_DIR/odoo.log
EOF
    chown odoo:odoo $CONF
    chmod 640 $CONF
fi

# Start Odoo
exec $ODOO_HOME/venv/bin/python $ODOO_HOME/odoo-bin -c $CONF

# ---- 1️⃣ Base Odoo image ----
FROM odoo:latest

# ---- 2️⃣ Install PostgreSQL + Supervisor ----
USER root
RUN apt-get update && \
    apt-get install -y postgresql postgresql-client supervisor && \
    rm -rf /var/lib/apt/lists/*
USER odoo   # restore the Odoo user for the rest of the image

# ---- 3️⃣ Make /data the PostgreSQL data directory ----
ENV PGDATA /data/postgres
RUN mkdir -p "$PGDATA" && \
    chown -R postgres:postgres "$PGDATA"

# ---- 4️⃣ Initialise the database (user+db) ----
RUN service postgresql start && \
    sudo -u postgres psql -c "CREATE USER ${POSTGRES_USER:-odoo} WITH PASSWORD '${POSTGRES_PASSWORD:-odoo}';" && \
    sudo -u postgres psql -c "CREATE DATABASE ${POSTGRES_DB:-odoo} OWNER ${POSTGRES_USER:-odoo};" && \
    service postgresql stop

# ---- 5️⃣ Point Odoo to the local Postgres instance ----
RUN sed -i "s/^; db_host =.*/db_host = localhost/" /etc/odoo/odoo.conf && \
    sed -i "s/^; db_user =.*/db_user = ${POSTGRES_USER:-odoo}/" /etc/odoo/odoo.conf && \
    sed -i "s/^; db_password =.*/db_password = ${POSTGRES_PASSWORD:-odoo}/" /etc/odoo/odoo.conf && \
    sed -i "s/^; db_name =.*/db_name = ${POSTGRES_DB:-odoo}/" /etc/odoo/odoo.conf && \
    sed -i "s/^; db_host = 127.0.0.1/db_host = localhost/" /etc/odoo/odoo.conf && \
    sed -i "s/^; db_port =.*/db_port = 5432/" /etc/odoo/odoo.conf

# ---- 6️⃣ Add Supervisor config and wrapper script ----
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY run.sh /run.sh
RUN chmod +x /run.sh

# ---- 7️⃣ Start everything ----
CMD ["/run.sh"]
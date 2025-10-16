FROM python:3.11-slim-bullseye

ENV LANG=C.UTF-8
ENV ODOO_VERSION=11.0
ENV ODOO_HOME=/opt/odoo
ENV PYTHONUNBUFFERED=1
ENV POSTGRES_USER=odoo
ENV POSTGRES_PASSWORD=odoo
ENV POSTGRES_DB=odoo
ENV POSTGRES_DATA=/data/postgres
ENV PATH=$ODOO_HOME/venv/bin:$PATH

# Install system dependencies + PostgreSQL + supervisor
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git build-essential \
        libxml2-dev libxslt1-dev zlib1g-dev libsasl2-dev libldap2-dev libpq-dev libjpeg-dev libssl-dev \
        libffi-dev node-less wget curl supervisor gettext \
        postgresql-13 postgresql-client-13 wkhtmltopdf \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create Odoo user and persistent folders
RUN useradd -m -d ${ODOO_HOME} -U -r -s /bin/bash odoo || true
RUN mkdir -p ${ODOO_HOME} /data/filestore /data/addons /etc/odoo ${POSTGRES_DATA} \
    && chown -R odoo:odoo /data ${POSTGRES_DATA} /etc/odoo ${ODOO_HOME}

# Clone Odoo source
WORKDIR /opt
RUN rm -rf ${ODOO_HOME} \
    && git clone --depth 1 --branch ${ODOO_VERSION} https://github.com/odoo/odoo.git ${ODOO_HOME} \
    && chown -R odoo:odoo ${ODOO_HOME}


RUN mkdir -p /var/run/postgresql && chown -R odoo:odoo /var/run/postgresql

# Switch to Odoo user for Python setup
USER odoo
WORKDIR ${ODOO_HOME}

# Create Python virtualenv and install requirements
RUN python3 -m venv venv
RUN pip install --upgrade pip setuptools wheel
RUN pip install -r ${ODOO_HOME}/requirements.txt || true
RUN pip install phonenumbers

# Switch back to root
USER root

# Copy run script and Odoo config template
COPY run.sh /usr/local/bin/run.sh
COPY odoo.conf.template /etc/odoo/odoo.conf.template
RUN chmod +x /usr/local/bin/run.sh

# Copy supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY start_postgres.sh /usr/local/bin/start_postgres.sh
RUN chmod +x /usr/local/bin/start_postgres.sh

# Expose Odoo port
EXPOSE 8069

# Persistent volume for Odoo and PostgreSQL data
VOLUME ["/data"]

# Start supervisord
ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

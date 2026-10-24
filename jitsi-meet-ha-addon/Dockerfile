# Jitsi Meet Home Assistant Add-on
# Full self-hosted Jitsi stack: prosody + jicofo + jvb + jitsi-meet web
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg2 \
    apt-transport-https \
    ca-certificates \
    jq \
    gettext-base \
    supervisor \
    nginx \
    lua5.2 \
    lua-unbound \
    wget \
    procps \
    openssl \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Add Jitsi apt repository
RUN curl -fsSL https://download.jitsi.org/jitsi-key.gpg.key | gpg --dearmor -o /usr/share/keyrings/jitsi.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/jitsi.gpg] https://download.jitsi.org stable/" \
       > /etc/apt/sources.list.d/jitsi-stable.list

# Install Jitsi components (non-interactive, skip postinst that needs a running system)
RUN apt-get update && \
    JITSI_VIDEOBRIDGE_OPTS="" \
    JICOFO_OPTS="" \
    apt-get install -y --no-install-recommends \
    prosody \
    jitsi-meet-web \
    jitsi-meet-web-config \
    jicofo \
    jitsi-videobridge2 \
    && rm -rf /var/lib/apt/lists/*

# Copy add-on files
RUN mkdir -p /etc/jitsi/meet /etc/jitsi/jicofo /etc/jitsi/videobridge /etc/nginx/conf.d
COPY run.sh /run.sh
COPY supervisord.conf /etc/supervisor/conf.d/jitsi.conf
COPY prosody.cfg.lua.tmpl /etc/jitsi/meet/prosody.cfg.lua.tmpl
COPY jicofo.conf.tmpl /etc/jitsi/jicofo/jicofo.conf.tmpl
COPY jvb.conf.tmpl /etc/jitsi/videobridge/jvb.conf.tmpl
COPY config.js.tmpl /etc/jitsi/meet/config.js.tmpl
COPY nginx-jitsi.conf.tmpl /etc/nginx/conf.d/jitsi.conf.tmpl
RUN chmod +x /run.sh

# Data directory (users, recordings, logs)
RUN mkdir -p /data/prosody /data/recordings /data/logs

# Expose ports
EXPOSE 80
EXPOSE 10000/udp
EXPOSE 4443

ENTRYPOINT ["/run.sh"]

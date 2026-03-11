# ─── Global ARGs (must be before any FROM to be usable in FROM lines) ────────
ARG BUILD_FROM
ARG GARAGE_VERSION=v1.0.1

# ─── Stage 1: Extract Garage Web UI ─────────────────────────────────────────
# khairul169/garage-webui is a Go backend + React frontend (single binary).
# We copy the full image filesystem and discover the executable at build time.
FROM khairul169/garage-webui:latest AS garage-webui-src

# ─── Stage 2: Final image ────────────────────────────────────────────────────
FROM ${BUILD_FROM}

ARG TARGETARCH
# Re-declare global ARGs inside the stage so they are accessible as env vars
ARG GARAGE_VERSION

LABEL \
    io.hass.name="Garage S3 Object Storage" \
    io.hass.description="Lightweight S3-compatible object storage (Garage) with Web UI" \
    io.hass.type="addon" \
    io.hass.arch="${TARGETARCH}" \
    maintainer="Andreas Hergert <andreashergert1984@googlemail.com>"

# ─── Runtime dependencies ────────────────────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        supervisor \
        jq \
        curl \
        openssl \
        ca-certificates \
        procps \
    && rm -rf /var/lib/apt/lists/*

# ─── Install Garage binary (statically compiled, musl) ───────────────────────
RUN set -e; \
    case "${TARGETARCH}" in \
        amd64)  GARAGE_ARCH="x86_64-unknown-linux-musl"        ;; \
        arm64)  GARAGE_ARCH="aarch64-unknown-linux-musl"        ;; \
        arm)    GARAGE_ARCH="armv6l-unknown-linux-musleabihf"   ;; \
        *)      echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac; \
    echo "Installing Garage ${GARAGE_VERSION} for ${GARAGE_ARCH}..."; \
    curl -fsSL \
        "https://garagehq.deuxfleurs.fr/_releases/${GARAGE_VERSION}/${GARAGE_ARCH}/garage" \
        -o /usr/local/bin/garage; \
    chmod +x /usr/local/bin/garage; \
    /usr/local/bin/garage --version

# ─── Install Garage Web UI ───────────────────────────────────────────────────
# Copy the webui image filesystem, locate the server binary (handles both
# scratch-based /server and app-based /app/server layouts), install it, and
# clean up to keep the final image lean.
COPY --from=garage-webui-src / /tmp/webui-root/
RUN set -e; \
    WEBUI_BIN=$(find /tmp/webui-root -maxdepth 4 -type f -executable \
        \( -name "main" -o -name "server" -o -name "garage-webui" -o -name "garage-webui-server" \) \
        2>/dev/null | head -1); \
    if [ -n "${WEBUI_BIN}" ]; then \
        echo "Found garage-webui binary at ${WEBUI_BIN}"; \
        install -m 755 "${WEBUI_BIN}" /usr/local/bin/garage-webui; \
    else \
        echo "WARNING: garage-webui binary not found — Web UI will be unavailable"; \
    fi; \
    rm -rf /tmp/webui-root

# ─── Add-on scripts and config ───────────────────────────────────────────────
COPY run.sh          /usr/local/bin/run.sh
COPY init_garage.sh  /usr/local/bin/init_garage.sh
COPY garage.toml.tmpl /etc/garage.toml.tmpl

RUN chmod +x /usr/local/bin/run.sh /usr/local/bin/init_garage.sh

# ─── Directories ─────────────────────────────────────────────────────────────
RUN mkdir -p /data/garage /config /media /var/log/supervisor /run/supervisor

# ─── Exposed ports ───────────────────────────────────────────────────────────
# 3900 = S3 API  |  3901 = RPC (cluster, internal)
# 3902 = S3 static website hosting  |  3903 = Admin API (internal)
# 3909 = Garage Web UI
EXPOSE 3900 3909

VOLUME ["/data", "/config", "/media"]

ENTRYPOINT ["/usr/local/bin/run.sh"]

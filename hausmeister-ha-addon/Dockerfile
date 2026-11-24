# Base image is set here (build.yaml is deprecated); multi-arch, the Supervisor picks the platform.
FROM docker.io/library/node:22-trixie-slim

LABEL \
    io.hass.name="Hausmeister" \
    io.hass.description="Smart home tickets that Claude Code works on after approval" \
    io.hass.type="addon" \
    maintainer="Andreas Hergert <andreashergert1984@googlemail.com>"

# Claude Code version is pinned; a new version comes with a new add-on version.
ARG CLAUDE_CODE_VERSION=2.1.326
ARG TTYD_VERSION=1.7.7
ARG BUILD_ARCH=amd64

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep jq curl ca-certificates procps less nano tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && case "${BUILD_ARCH}" in \
         amd64) T=x86_64; S=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55 ;; \
         aarch64) T=aarch64; S=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165 ;; \
         *) echo "unsupported arch ${BUILD_ARCH}"; exit 1 ;; \
       esac \
    && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${T}" \
    && echo "${S}  /usr/local/bin/ttyd" | sha256sum -c - \
    && chmod +x /usr/local/bin/ttyd \
    && npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

COPY app /app
RUN printf '#!/bin/sh\nexec env HA_TOOL_MODE=read node /app/bin/ha.js "$@"\n' > /usr/local/bin/ha-read \
    && printf '#!/bin/sh\nexec env HA_TOOL_MODE=write node /app/bin/ha.js "$@"\n' > /usr/local/bin/ha-api \
    && cp /app/bin/cfg-git /usr/local/bin/cfg-git \
    && chmod +x /usr/local/bin/ha-read /usr/local/bin/ha-api /usr/local/bin/cfg-git /app/run.sh

ENV HOME=/data/home \
    DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

CMD ["/app/run.sh"]

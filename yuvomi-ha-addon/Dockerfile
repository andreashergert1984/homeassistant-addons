ARG BUILD_FROM
FROM ${BUILD_FROM}

LABEL \
    io.hass.name="Yuvomi Family Planner" \
    io.hass.description="Self-hosted family planner (upstream Yuvomi image)" \
    io.hass.type="addon" \
    maintainer="Andreas Hergert <andreashergert1984@googlemail.com>"

COPY terminal /terminal
RUN cd /terminal && npm install --omit=dev --no-audit --no-fund && chown -R node:node /terminal

COPY run.sh /run-addon.sh
RUN chmod +x /run-addon.sh

ENTRYPOINT ["/run-addon.sh"]
CMD ["node", "server/index.js"]

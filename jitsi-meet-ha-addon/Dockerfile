# Jitsi Meet Home Assistant Add-on
# Simple static web server hosting Jitsi Meet web interface
FROM nginx:alpine

# Install jq for parsing options
RUN apk add --no-cache jq bash

# Copy files
COPY run.sh /run.sh
COPY index.html /usr/share/nginx/html/index.html
RUN chmod +x /run.sh

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 80

# Entry point
ENTRYPOINT ["/run.sh"]

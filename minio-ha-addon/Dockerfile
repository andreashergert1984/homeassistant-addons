# Build stage to get jq
FROM alpine:latest AS builder
RUN apk add --no-cache jq

# Final stage
FROM minio/minio:latest

# Copy jq from builder
COPY --from=builder /usr/bin/jq /usr/bin/jq

# Create directories for MinIO data
RUN mkdir -p /data/minio /config

# Copy startup script
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh

# Expose MinIO API and Console ports
EXPOSE 9000 9001

# Persistent volumes
VOLUME ["/data", "/config"]

# Start MinIO via our wrapper script
ENTRYPOINT ["/usr/local/bin/run.sh"]

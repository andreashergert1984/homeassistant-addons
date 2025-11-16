
FROM minio/minio:latest

# Download static jq binary
ADD https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 /usr/bin/jq
RUN chmod +x /usr/bin/jq

# Create directories for MinIO data
RUN mkdir -p /data/minio /config

# Copy startup script
COPY run.sh /usr/local/bin/run.sh
RUN chmod +x /usr/local/bin/run.sh

# Expose MinIO API and Console ports
EXPOSE 9000 9001

# Persistent volumes
VOLUME ["/data", "/config", "/media"]

# Start MinIO via our wrapper script
ENTRYPOINT ["/usr/local/bin/run.sh"]

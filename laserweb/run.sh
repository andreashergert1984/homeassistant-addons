#!/bin/bash

echo "Starting LaserWeb..."

# Ensure the /data directory is used for persistence
if [ ! -d "/data/config" ]; then
    echo "No existing config found. Initializing..."
    mkdir -p /data/config
    cp -r /usr/src/laserweb/config/* /data/config
fi

# Link /data/config to the application directory
ln -sfn /data/config /usr/src/laserweb/config

# Start LaserWeb
export HOST=0.0.0.0
export PORT=8090
npm start

FROM node:16-alpine

# Install necessary tools and dependencies
RUN apk add --no-cache git bash

# Clone LaserWeb
RUN git clone https://github.com/LaserWeb/LaserWeb4.git /usr/src/laserweb

# Set working directory
WORKDIR /usr/src/laserweb

# Install LaserWeb dependencies
RUN npm install

# Ensure the /data directory is created
RUN mkdir -p /data

# Copy the startup script
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Expose the port used by LaserWeb
EXPOSE 8090

# Start the application
CMD ["/run.sh"]

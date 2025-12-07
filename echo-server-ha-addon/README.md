# Echo Server Home Assistant Add-on

This add-on provides a simple echo webserver. It replies to any HTTP request with the request method, path, headers, and body.

## Configuration
- `port`: The port to expose (default: 8080).

## Usage
1. Build locally:
   ```bash
   docker build -t echo-server-ha-addon:local ./echo-server-ha-addon
   ```
2. Run:
   ```bash
   docker run --rm -it -p 8080:8080 echo-server-ha-addon:local
   ```
3. Send requests to `http://localhost:8080/` and see the echoed response.

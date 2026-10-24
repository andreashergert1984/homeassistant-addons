# Jitsi Meet Add-on Documentation

## Architecture

This add-on runs the **complete self-hosted Jitsi Meet stack** inside a single container:

| Process | Role |
|---------|------|
| **Prosody** | XMPP server — handles signaling, BOSH, WebSocket |
| **Jicofo** | Conference focus — orchestrates participants |
| **JVB** (Jitsi Video Bridge) | Media relay — routes all audio and video streams |
| **Nginx** | Web frontend — serves the Jitsi Meet UI on port 80 |

All processes are managed by **supervisord**. Logs are written to `/data/logs/`.

---

## Prerequisites

### 1. Port Forwarding (Router)
JVB needs direct UDP access for media. On your router, forward:

| External | Internal (HA host) | Protocol |
|----------|-------------------|----------|
| 10000 | 10000 | **UDP** |
| 4443 | 4443 | TCP (fallback) |

> UDP 10000 cannot be proxied by Nginx Proxy Manager — it must be forwarded directly.

### 2. Nginx Proxy Manager (HTTPS)
Create a proxy host in NPM:

- **Domain**: `meet.yourdomain.com`
- **Scheme**: `http`
- **Forward hostname/IP**: `<your-HA-host-ip>`
- **Forward port**: `8000`
- **SSL**: Let's Encrypt (enable "Force SSL" and "HTTP/2 Support")
- **WebSocket Support**: ✅ Enable

This provides the HTTPS that WebRTC (camera/microphone) requires.

---

## Configuration Options

### `public_url` (required)
The full HTTPS URL you set up in NPM, e.g. `https://meet.yourdomain.com`.  
This is used to derive the XMPP domain and wired into all four component configs.

### `jvb_advertise_host` (recommended)
Your Home Assistant host's **public IP address or DDNS hostname** (e.g. `myhome.duckdns.org`).  
The add-on resolves the hostname to an IP at startup, so **dynamic IPs with DDNS are fully supported**.  
Leave empty only if all participants are on the same LAN.

### `default_room`
Room name pre-filled on the welcome page. Default: `HomeAssistant`.

### `enable_auth`
When `true`, only registered Prosody users can create rooms.  
Register users inside the running container:
```bash
docker exec <container_id> prosodyctl register alice meet.yourdomain.com secretpassword
```

### `enable_guests`
When `enable_auth` is true, guests (unauthenticated users) can still join existing rooms.

### `enable_recording`
Enables the recording button in the UI. Actual recording requires [Jibri](https://github.com/jitsi/jibri), which is not included.

### `timezone`
Server timezone, e.g. `Europe/Berlin`.

---

## Persistent Data

All state is stored in `/data` (mapped to the HA host):

| Path | Contents |
|------|----------|
| `/data/prosody/` | Prosody user accounts and room data |
| `/data/prosody/certs/` | Self-signed internal TLS certs (auto-generated) |
| `/data/jitsi-secrets.env` | Auto-generated shared secrets (JVB, Jicofo) — do not delete |
| `/data/logs/` | Logs for all 4 processes |
| `/data/recordings/` | Meeting recordings (if recording is enabled) |

---

## Troubleshooting

**Video/audio does not work for remote participants:**  
→ Check that UDP port 10000 is forwarded on your router to your HA host.  
→ Set `jvb_advertise_host` to your public IP or DDNS hostname.

**Camera/microphone not accessible:**  
→ Your browser requires HTTPS. Make sure Nginx Proxy Manager has SSL configured.

**Participants cannot join:**  
→ Tail `/data/logs/jvb.log` and `/data/logs/prosody.log` for errors.

**Reset to clean state:**  
→ Delete `/data/jitsi-secrets.env` to regenerate all secrets on next start.  
→ Delete `/data/prosody/` to clear all user accounts.

- Restrict admin ports (only 8000/8443 need public access)
- Keep the add-on updated

## Integration with Home Assistant

You can:
- Create automations to log meeting activity
- Use webhooks to trigger HA events
- Embed Jitsi in HA Lovelace dashboards using iframes

## Logs

Nginx logs are available via `docker logs` command.

For troubleshooting, check:
- Browser console for JavaScript errors
- Network tab for connection issues
- meet.jit.si status page for service availability

## Known Limitations

- Uses meet.jit.si infrastructure (requires internet connection)
- For fully self-hosted solution, you'd need separate Prosody, Jicofo, and JVB containers
- Meeting data passes through meet.jit.si servers (encrypted end-to-end)
- Subject to meet.jit.si terms of service and availability

## External Resources

- [Jitsi Documentation](https://jitsi.github.io/handbook/)
- [Jitsi Community](https://community.jitsi.org/)
- [Security Best Practices](https://jitsi.github.io/handbook/docs/devops-guide/secure-domain)

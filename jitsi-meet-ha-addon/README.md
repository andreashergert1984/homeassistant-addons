# Jitsi Meet Home Assistant Add-on

Self-hosted Jitsi Meet video conferencing running entirely inside a single Home Assistant add-on container (Prosody + Jicofo + JVB + Nginx).

## Features

- **Fully Self-Hosted**: No dependency on meet.jit.si — all traffic stays on your infrastructure
- **Full Video Conferencing**: HD video and audio with multiple participants
- **Screen Sharing**: Share your screen with meeting participants
- **Chat**: In-meeting text chat functionality
- **Mobile Support**: Works on mobile browsers
- **Optional Authentication**: Restrict room creation to registered users

## Setup Checklist

Before starting the add-on, complete these steps:

- [ ] **Router — forward UDP 10000** to your Home Assistant host IP (required for JVB media streams)
- [ ] **Router — forward TCP 4443** to your Home Assistant host IP (JVB TCP fallback)
- [ ] **Nginx Proxy Manager** — create a proxy host:
  - Domain: `meet.yourdomain.com`
  - Scheme: `http`, Forward host/IP: `<HA-host-IP>`, Port: `8000`
  - SSL: Let's Encrypt, enable "Force SSL" and "HTTP/2 Support"
  - Enable **WebSocket Support**
- [ ] **Add-on config** — set `public_url` to your HTTPS domain (e.g. `https://meet.yourdomain.com`)
- [ ] **Add-on config** — set `jvb_advertise_host` to your public IP or DDNS hostname (e.g. `myhome.duckdns.org`)

## Installation

1. Copy this folder to your Home Assistant add-ons repository
2. In HA UI, refresh the Add-on Store
3. Find "Jitsi Meet" and click Install
4. Configure the add-on options (see Configuration below)
5. Start the add-on
6. Access Jitsi Meet at `https://meet.yourdomain.com`

## Configuration

### Options

- `public_url` *(required)*: The public HTTPS URL, e.g. `https://meet.yourdomain.com`. Must match the domain in Nginx Proxy Manager.
- `jvb_advertise_host` *(recommended)*: Your public IP **or DDNS hostname** (e.g. `myhome.duckdns.org`) for NAT traversal. The hostname is resolved to an IP at startup, so dynamic IPs are fully supported. Required for remote participants outside your LAN.
- `default_room`: Room name pre-filled on the welcome page (default: `HomeAssistant`)
- `enable_auth`: Enable authentication — only registered Prosody users can create rooms
- `enable_guests`: Allow unauthenticated guests to join existing rooms (when auth is enabled)
- `enable_recording`: Show recording button in the UI (requires Jibri — not included)
- `timezone`: Server timezone (default: `Europe/Berlin`)

### Example Configuration

```yaml
public_url: "https://meet.yourdomain.com"
jvb_advertise_host: "myhome.duckdns.org"
default_room: "HomeAssistant"
enable_auth: false
enable_guests: true
enable_recording: false
timezone: "Europe/Berlin"
```

## Network Requirements

| Port | Protocol | Purpose | How to expose |
|------|----------|---------|--------------|
| 8000 | TCP | Web UI | Via Nginx Proxy Manager (HTTPS) |
| 10000 | **UDP** | JVB media streams | **Router port forward — required** |
| 4443 | TCP | JVB TCP fallback | Router port forward |

> UDP 10000 cannot go through Nginx Proxy Manager — it must be forwarded directly on your router.

## Registering Users (when `enable_auth: true`)

```bash
docker exec <container_id> prosodyctl register alice meet.yourdomain.com secretpassword
```

## Troubleshooting

**Video/audio does not work for remote participants:**
- Verify UDP port 10000 is forwarded on your router to the HA host
- Set `jvb_advertise_host` to your public IP or DDNS hostname (e.g. `myhome.duckdns.org`)

**Camera/microphone not accessible:**
- Browser requires HTTPS — make sure NPM has SSL configured and "Force SSL" is enabled

**Participants cannot join / connection errors:**
- Tail logs: `/data/logs/jvb.log`, `/data/logs/prosody.log`, `/data/logs/jicofo.log`

**Reset to clean state:**
- Delete `/data/jitsi-secrets.env` to regenerate all shared secrets on next start
- Delete `/data/prosody/` to clear all user accounts


# Jitsi Meet Home Assistant Add-on

This add-on provides a convenient web interface for Jitsi Meet video conferencing using meet.jit.si infrastructure.

## Features

- **Full Video Conferencing**: HD video and audio with multiple participants
- **Screen Sharing**: Share your screen with meeting participants
- **Chat**: In-meeting text chat functionality
- **Mobile Support**: Works on mobile browsers
- **No Account Required**: Guests can join without registration
- **Easy Access**: Simple interface embedded in Home Assistant

## Installation

1. Copy this folder to your Home Assistant add-ons repository
2. In HA UI, refresh the Add-on Store
3. Find "Jitsi Meet" and click Install
4. Configure the add-on options (see Configuration below)
5. Start the add-on
6. Access Jitsi Meet at `http://<home-assistant-host>:8000`

## Configuration

### Options

- `public_url`: The public URL where Jitsi will be accessible (e.g., `https://meet.yourdomain.com`)
- `enable_auth`: Enable authentication (users must be registered to create rooms)
- `enable_guests`: Allow guests to join rooms (when auth is enabled)
- `enable_recording`: Enable meeting recording functionality
- `jvb_port`: UDP port for Jitsi Videobridge (default: 10000)
- `timezone`: Server timezone (default: UTC)

### Example Configuration

```yaml
public_url: "https://meet.example.com"
enable_auth: false
enable_guests: true
enable_recording: false
jvb_port: 10000
timezone: "Europe/Berlin"
```

## Network Requirements

- Port 8000 (HTTP) - Web interface
- Internet connection for meet.jit.si API

**Important:** Modern browsers require HTTPS for WebRTC (camera/microphone access) when accessing from non-localhost addresses. 

### Solutions:
1. **Use the "Open meet.jit.si directly" button** - Opens the meeting in a new tab with HTTPS
2. **Set up HTTPS reverse proxy** - Use nginx or Home Assistant's built-in ingress with SSL
3. **Access via localhost** - If you can access at http://127.0.0.1:8000, WebRTC will work

## Usage

1. Open your browser and go to `http://<your-ha-ip>:8000`
2. Enter a room name and click "Go"
3. Allow camera and microphone access
4. Share the room URL with participants
5. Start your meeting!

## Troubleshooting

## Troubleshooting

**"WebRTC is not available in your browser" error:**
- This occurs when accessing over HTTP from a non-localhost address
- **Quick fix**: Click the "Open meet.jit.si directly" button to open in a new tab with HTTPS
- **Permanent fix**: Set up HTTPS access (see solutions above)

**Video/Audio not working:**
- Check browser permissions for camera/microphone
- Ensure stable internet connection
- Try using a different browser

**Can't connect to meeting:**
- Check that the add-on is running
- Verify internet connection
- Check browser console for errors

## Advanced

This add-on provides a web interface to meet.jit.si. For a fully self-hosted solution with your own Jitsi infrastructure, you would need to run separate containers for Prosody, Jicofo, and JVB components.

### Customization

You can customize the meeting interface by modifying the `/usr/share/nginx/html/index.html` file in the container.

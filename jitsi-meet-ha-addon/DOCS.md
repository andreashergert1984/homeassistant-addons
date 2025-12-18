# Jitsi Meet Add-on Documentation

## What is Jitsi Meet?

Jitsi Meet is an open-source video conferencing solution that provides secure, high-quality video calls. This add-on provides a web interface that connects to the public meet.jit.si infrastructure.

## Architecture

This add-on provides:

- **Nginx**: Web server serving the Jitsi Meet interface
- **Embedded API**: Uses meet.jit.si's External API for video conferencing
- **Simple Interface**: Easy-to-use web interface for creating and joining meetings

## Configuration Details

### Public URL
The `public_url` setting should match how users will access your Jitsi instance. This is important for:
- BOSH/WebSocket connections
- STUN/TURN server configuration
- SSL certificate validation (if using HTTPS)

If you're using a reverse proxy with SSL, set this to your HTTPS domain.

### Authentication
When `enable_auth` is `true`:
- Only registered users can create new rooms
- You must manually register users via Prosody
- Guest access is controlled by `enable_guests`

To register a user:
```bash
docker exec <container> prosodyctl register <username> <domain> <password>
```

### Public URL
The `public_url` setting is currently informational. The add-on uses meet.jit.si infrastructure for the actual video conferencing.

## Performance Tuning

For large meetings (>10 participants):
- Increase available memory for the add-on
- Use a dedicated machine if possible
- Consider enabling simulcast (enabled by default)
- Monitor CPU usage during meetings

## Security Considerations

### Without Authentication
- Anyone with the room URL can join
- Room names should be unpredictable
- Consider using lobby mode for sensitive meetings

### With Authentication
- Only registered users can host
- Better control over who creates rooms
- Guests can still join if `enable_guests` is true

### Network Security
- Use HTTPS in production (configure reverse proxy)
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

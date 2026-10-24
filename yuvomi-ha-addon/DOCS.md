# Yuvomi Family Planner

Runs the upstream [Yuvomi](https://github.com/ulsklyc/yuvomi) image unchanged.

## First start

1. Start the add-on and open `http://<ha-ip>:3000`.
2. Create the admin account in the setup screen.

## Data

| What | Where |
| --- | --- |
| Encrypted SQLite database | add-on `/data/yuvomi.db` (included in HA backups) |
| Session secret, DB encryption key | add-on `/data/secrets.env`, generated once |
| Scheduled app backups | `/share/yuvomi/backups` |
| Uploaded documents | `/share/yuvomi/documents` |

The database is encrypted with the key in `secrets.env`. Keep HA backups of
the add-on: without that file the database cannot be opened.

## HTTPS

Yuvomi has no sub-path support, so there is no ingress panel. For HTTPS put a
reverse proxy in front, then set **Secure cookies** to on and **Trust proxy**
to `1`.

## Updates

The add-on version equals the pinned upstream image tag. Bump `version` in
`config.yaml` and the tags in `build.yaml` together.

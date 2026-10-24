# Yuvomi Family Planner

Runs the upstream [Yuvomi](https://github.com/ulsklyc/yuvomi) image unchanged.

## First start

1. Start the add-on and open `http://<ha-ip>:3000`.
2. Create the admin account in the setup screen.

## Pantry terminal (sidebar "Vorrat")

A scan page for the pantry, meant for a phone or tablet on the wall.

1. In Yuvomi: Settings, Household, API access, create a token with scope `pantry:write`.
2. Paste it into the add-on option **API token** and restart the add-on.
3. Open "Vorrat" in the HA sidebar (needs HTTPS for the camera).

Modes: **Auslagern** (each scan takes 1, earliest expiry first, with undo), **Einlagern** (quantity, best-before date, location), **Zählen** (set the real stock). Scan with the camera or with a keyboard-wedge scanner (USB, PS/2 via adapter). Items without a barcode go on tiles ("Ohne Code"). Unknown barcodes are asked once; the name is suggested from Open Food Facts (switch off with the option, then no code leaves your network). The mapping barcode to article is kept in `/data/terminal.json`.

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
`config.yaml` (`<upstream>-<n>` for add-on only changes) and the tags in `build.yaml` together.

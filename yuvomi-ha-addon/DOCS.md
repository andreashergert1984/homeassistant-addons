# Yuvomi Family Planner

Runs the upstream [Yuvomi](https://github.com/ulsklyc/yuvomi) image unchanged.

## First start

1. Start the add-on and open `http://<ha-ip>:3000`.
2. Create the admin account in the setup screen.

## Pantry terminal (sidebar "Vorrat")

A scan page for the pantry, meant for a phone or tablet on the wall. It books
into the Yuvomi pantry through the Yuvomi API, so it needs an API token.

### 1. Create the API token in Yuvomi

1. Open Yuvomi (`http://<ha-ip>:3000`) and log in as an admin.
2. Go to **Settings → Household → API access** (Einstellungen → Haushalt → API-Zugriff).
3. Create a new token:
   - **Name:** e.g. `Vorrat-Terminal`.
   - **Acts as:** the person the bookings should belong to.
   - **Expiration:** choose **no expiration**. Since Yuvomi 2.81 the form preselects
     90 days; the terminal stops working when the token expires.
   - **Module limit:** keep it on and allow only **Pantry** with **write** access
     (`pantry:write`). The terminal needs nothing else.
4. Copy the token right away. Yuvomi shows it only once.

### 2. Enter it in the add-on

1. **Settings → Add-ons → Yuvomi Family Planner → Configuration.**
2. Paste the token into **Pantry terminal API token**. If the field is not shown,
   switch on "Show unused optional configuration options".
3. Save, then restart the add-on on the **Info** tab.

### 3. Show it in the sidebar

On the **Info** tab switch on **Show in sidebar**. "Vorrat" with a barcode icon
appears in the sidebar. The panel is also shown to non-admin users, so a wall
phone can use a restricted HA account.

### 4. Camera

The camera works only over HTTPS. If the camera field says
"Keine Kamera verfügbar (TypeError)", the page is not on HTTPS: the HA companion
app uses its **internal URL** at home, often `http://<ip>:8123`. Set the internal
URL in the app (Settings → Companion app → server) to the HTTPS address as well.
Grant the app the camera permission in Android.

If the page says "Add-on-Optionen prüfen: api_token", step 2 is missing or the
add-on was not restarted.

### Use

- **Auslagern** (default): each scan takes 1, earliest best-before date first,
  with **Rückgängig** (undo). **Ändern** after a scan sets another quantity,
  e.g. a crate of 20, or picks the batch by best-before date.
- **Einlagern:** quantity, best-before date (quick choices or a date) and location.
- **Zählen:** set the real stock; the fastest way for a first inventory.
- After 3 minutes without a scan the mode goes back to Auslagern.
- Scan with the camera or with a keyboard-wedge scanner (USB, PS/2 via an
  active adapter).
- Items without a barcode go on tiles ("Ohne Code", "+ Neu").
- Unknown barcodes are asked once; the name is suggested from Open Food Facts.
  Switch that off with the option, then no code leaves your network.
- The mapping barcode to article is kept in `/data/terminal.json`.

### Wall device

- Pin the app (Android "App pinning") so the device stays on the terminal.
- Keep it on the charger; if the device can limit charging to 80 %, use that.
- The screen stays on while the page is open.

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

Yuvomi itself has no sub-path support, so it does not run in the HA sidebar;
only the pantry terminal does. For HTTPS on Yuvomi put a reverse proxy in
front, then set **Secure cookies** to on and **Trust proxy** to `1`.

## Updates

The add-on version equals the pinned upstream image tag. Bump `version` in
`config.yaml` (`<upstream>.<n>` for add-on only changes; not `-<n>`, HA reads that as a pre-release older than `<upstream>`) and the tags in `build.yaml` together.

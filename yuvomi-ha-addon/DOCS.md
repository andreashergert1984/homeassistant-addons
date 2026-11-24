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

**Front or back camera:** the button "Kamera wechseln" in the camera picture
switches between the back camera (default) and the front camera. The choice is
stored on the device. Use the front camera on a wall device: hold the barcode
15 to 25 cm in front of the display. The same code is booked again only after it
was out of the picture for about 2.5 seconds, so holding it too long does not
book twice.

**Without camera:** with a hand scanner the camera is not needed. "Kamera aus"
in the camera picture switches it off on this device (stored there); the space
then goes to a larger status line and a list of the last bookings ("Zuletzt",
undone bookings crossed out, only kept until the page reloads). "Kamera an"
above that list brings the camera back. Without camera the page also keeps a
margin at the top and bottom, so the notice Fully Kiosk shows without a licence
does not cover the buttons.

**Scanner engine:** by default the terminal decodes with ZXing (plain JavaScript).
The browser's own `BarcodeDetector` needs Google Play services on Android and
crashes the WebView on devices without them; opening the terminal directly with
`?scanner=native` switches to it (not possible inside the HA sidebar frame).

If the page says "Add-on-Optionen prüfen: api_token", step 2 is missing or the
add-on was not restarted.

### Use

- **Auslagern** (default): each scan takes 1, earliest best-before date first,
  with **Rückgängig** (undo). **Ändern** after a scan sets another quantity,
  e.g. a crate of 20, or picks the batch by best-before date.
- **Einlagern:** quantity, best-before date (quick choices or a date) and location.
- **Zählen:** set the real stock; the fastest way for a first inventory.
- After 3 minutes without a scan the mode goes back to Auslagern.
- Scan with the camera or with a keyboard-wedge scanner (USB, Bluetooth HID,
  PS/2 via an active adapter). Set the scanner to send Enter after the code, no
  prefix or suffix. EAN-8 to EAN-14 / UPC are accepted (8 to 14 digits). Inside
  the HA sidebar the scanner works even when the HA page around the terminal has
  the focus; while a text field is focused the scan goes into that field.
- Items without a barcode go on tiles ("Ohne Code", "+ Neu").
- Unknown barcodes are asked once; the name is suggested from Open Food Facts.
  Switch that off with the option, then no code leaves your network.
- The mapping barcode to article is kept in `/data/terminal.json`.

### Wall device

- Pin the app (Android "App pinning") so the device stays on the terminal.
- Keep it on the charger; if the device can limit charging to 80 %, use that.
- The screen stays on while the page is open; decoding pauses while the screen is off.
- Every scan flashes the screen (green booked, orange last stock or short, red
  error) and beeps. Android WebViews often allow sound only after the first touch.
- With Fully Kiosk and its Home Assistant integration an automation can switch
  the screen on when the pantry door opens and off a few minutes after it closes.

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

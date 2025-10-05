# Odoo 16 (Home‑Assistant) – Add‑on

This add‑on runs Odoo 16 with an **embedded PostgreSQL database** inside a single Docker container.  
All database files are stored in the Home Assistant‑managed persistent volume (`/data/postgres`), so your data survives reinstallations and image rebuilds.

## Features

- No external volumes – the Supervisor mounts `/data` automatically.
- Exposes:
  - Odoo UI on **port 8069**
  - PostgreSQL on **port 5432** (optional)
- Configurable via Home Assistant environment variables.
- Managed by Home Assistant’s supervisor – start/stop/restart automatically.

## Installation

1. **Add the repository**  
   `Configuration → Add‑on Store → Repositories → +`  
   Paste the URL of this repo (e.g. `https://github.com/yourname/odoo-ha-addon`).

2. **Install** the add‑on, then click **Start**.

3. Open the UI at `http://<HA_IP>:8069`.  
   On first run you’ll be prompted to set the admin password (default: `admin`).

## Customisation

All secrets and defaults are set in `addon.json`.  
From the HA UI you can change:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `ODOO_ADMIN_PASSWORD`
- `ODOO_EXTERNAL_URL`

> **Note** – The database is *not* persisted outside the container.  
> If you need data retention beyond a container lifetime, run PostgreSQL on the host or a separate container and point Odoo to it.

## Updating

When a new tag is pushed to this repo, HA will automatically:

1. Rebuild the image (using the Dockerfile).  
2. Show “Update available” in the add‑on store.  
3. Let the user click **Update** to pull the new image and restart.

> **Tip** – If you want Odoo 17, change the `FROM` line in the Dockerfile, bump `version` in `addon.json`, commit, tag and push. The add‑on will appear as a new version in HA.

Happy Odoo‑ing!
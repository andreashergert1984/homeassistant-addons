# Odoo Home Assistant Add-on (Debian-based)


This add-on runs Odoo 19 inside a Home Assistant Supervisor add-on container.


**Important**: Odoo requires a PostgreSQL database. Configure database connection in the add-on options before starting.


### Installation
1. Copy this folder to your Home Assistant add-ons local repository (e.g. `/addons/local/odoo`).
2. In HA UI, go to Add-on Store -> three dots -> Repositories -> Add local repository pointing to folder, or use the Local add-on installation method.
3. Open add-on options and set `db_host`, `db_user`, `db_password`, and `admin_passwd`.
4. Start the add-on.
5. Visit `http://<home-assistant-host>:8069`.
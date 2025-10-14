# Odoo Add-on Documentation

## Workflow

- On first start, the script checks if the PostgreSQL data folder has been initialized (`/data/postgres/PG_VERSION`). If not, it runs `initdb`, starts Postgres, creates the user and DB, then shuts it down.  
- Then, using `supervisord`, it starts PostgreSQL, then Odoo.  
- Odoo is configured (via command ‑line) to connect to Postgres at `127.0.0.1` inside the container.

## Configuration Options Table

| Option               | Default        | Description                                |
|----------------------|------------------|--------------------------------------------|
| db_user              | `odoo`           | PostgreSQL username                       |
| db_password          | `odoo`           | PostgreSQL user password                  |
| db_name              | `odoo`           | Database name for Odoo                    |
| odoo_admin_password  | `admin`          | Master/admin password for Odoo             |
| addons_path          | `/mnt/data/addons` | Where to mount/add custom Odoo modules inside container |

## Accessing Odoo

Open a web browser to:


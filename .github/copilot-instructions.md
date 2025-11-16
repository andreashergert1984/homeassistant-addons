## Repo purpose (big picture)
This repository contains Home Assistant Supervisor "add-on" source folders. Each top-level folder (for example `odoo-ha-addon/`, `minio-ha-addon/`, and `gitlab-ce/`) is an independent add-on that builds a container image intended to run under Home Assistant Supervisor.

Key ideas:
- `odoo-ha-addon`: bundles Odoo 18 and an embedded PostgreSQL instance, supervisord is used to run both Postgres and Odoo, and all persistent state is placed under `/data` so Supervisor can map it to the host.
- `minio-ha-addon`: runs MinIO S3-compatible object storage server with configurable admin credentials and data path (default: `/data/minio`).

## Architecture & startup flow (read these files)
- `odoo-ha-addon/Dockerfile` — base image, installed packages, copies `run.sh` and `start_postgres.sh`, and uses `supervisord` as ENTRYPOINT.
- `odoo-ha-addon/supervisord.conf` — supervisord config that starts `postgres` and `odoo` programs (log files placed under `/data`).
- `odoo-ha-addon/start_postgres.sh` — initializes the PostgreSQL cluster in `/data/postgres` (runs `initdb` as the `odoo` user) and starts `postgres`.
- `odoo-ha-addon/run.sh` — waits for PostgreSQL readiness, renders `/etc/odoo/odoo.conf` from `odoo.conf.template` if missing, then execs `odoo-bin` from the virtualenv.
- `odoo-ha-addon/odoo.conf.template` — template for Odoo configuration used by `run.sh`.
- `odoo-ha-addon/config.yaml` — Home Assistant add-on manifest (options, mapped ports, environment defaults like POSTGRES_USER, map_data/map_config semantics).
- `odoo-ha-addon/build.json` — metadata used by local build tooling (shows base image per arch).

Why this layout matters to an AI agent:
- The container runs multiple processes via `supervisord`. Don't assume single-process patterns (no simple CMD that launches Odoo only).
- Data persistence is explicitly under `/data` and the add-on manifest uses `map_data: true` — tests and debug runs must mount or inspect that path.

## Developer workflows & useful commands (concrete examples)
### Odoo add-on
- Build locally (quick smoke):
  - `docker build -t odoo-ha-addon:local ./odoo-ha-addon`
- Run container for debugging (bind port and a local data dir):
  - `mkdir -p /tmp/odoo-data && docker run --rm -it -p 8069:8069 -v /tmp/odoo-data:/data odoo-ha-addon:local`
  - Tail logs: `docker logs -f <container-id>` or inspect files inside `/tmp/odoo-data` (e.g. `odoo.log`, `postgres.log`, `supervisor.log`).
- Quick local dev without Docker: you can replicate the entry sequence by creating a Python 3.11 venv, installing `odoo` requirements and running:
  - `python3 -m venv .venv && source .venv/bin/activate && pip install -r odoo-ha-addon/requirements.txt`
  - Edit a rendered `odoo.conf` (see `odoo.conf.template`), then run `./odoo-bin -c /path/to/odoo.conf` from the Odoo source tree. (This is useful for stepping through Python-only changes.)

### MinIO add-on
- Build locally: `docker build -t minio-ha-addon:local ./minio-ha-addon`
- Run for debugging (exposes API:9000, Console:9001):
  - `mkdir -p /tmp/minio-data && docker run --rm -it -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=minio123 -v /tmp/minio-data:/data minio-ha-addon:local`
  - Access console at `http://localhost:9001` with admin/minio123
- Test S3 operations: use `mc` (MinIO client) or any S3 SDK pointed at `http://localhost:9000`

## Project-specific conventions and gotchas
- Add-on layout: each add-on must contain `config.yaml` and `Dockerfile`. The Supervisor expects `map_data` and `map_config` semantics from `config.yaml`.
- Embedded Postgres: default `run.sh` assumes `db_host = 127.0.0.1` (embedded). The add-on exposes options to override DB connection — if you need an external DB, set `db_host` and friends in the add-on options.
- Permission elevation: many scripts perform `su - odoo` or create files in `/data`; logs and DB files are owned by `odoo:odoo`. When debugging as root, pay attention to file ownership.
- Requirements install is forgiving: `pip install -r requirements.txt || true` is used in the Dockerfile, so dependency failures may be ignored during build; double-check installed packages at runtime.
- Supervisord runs as PID 1; `ENTRYPOINT` is `supervisord`. So to alter startup behavior, edit `supervisord.conf` or the scripts copied into the image.

## Integration points & external dependencies
- Home Assistant Supervisor — add-on manifest (`config.yaml`) fields (ports, map_data/map_config) are meaningful only in Supervisor context.
- External network: Odoo expects port 8069; `ODOO_EXTERNAL_URL` in `config.yaml` is a useful hint but not enforced in code.
- Source of truth for Odoo: the `odoo` source is cloned in the Dockerfile from upstream Git (branch `18.0`). If you change code, prefer mounting `/data/addons` for custom modules.

## What to inspect when answering or editing code
- Always reference and open `run.sh` and `start_postgres.sh` to understand lifecycle: they contain the templating, startup/wait logic and ownership handling.
- Check `/data` log files in `supervisord.conf` (`/data/odoo.log`, `/data/postgres.log`, `/data/supervisor.log`) when diagnosing runtime issues.
- When changing Dockerfile dependency lines note the commented pip installs — CI or local builds may rely on the exact set of installed packages.

## Examples to copy into suggestions
- To suggest a runtime check: "Tail the supervisor log at `/data/supervisor.log` (inside the running container or in mapped host dir)."
- To suggest adding a new env option: reference `odoo-ha-addon/config.yaml` and keep `map_data: true` if the option affects persisted data.

## Add-on-specific notes
### MinIO (`minio-ha-addon/`)
- Single-process container (no supervisord); `run.sh` is ENTRYPOINT and execs `minio server`
- Reads `/data/options.json` (Home Assistant options) using `jq` to extract `admin_user`, `admin_password`, `data_path`, `browser_enabled`
- Default data path is `/data/minio`; configurable via `data_path` option
- Exposes two ports: 9000 (S3 API) and 9001 (Web Console)
- Environment variables: `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` must be set (handled by `run.sh`)

## Closing / feedback
This file lives at `.github/copilot-instructions.md`. If any sections are unclear or you'd like more examples (for `gitlab-ce/` or other add-ons), tell me which add-on to inspect next and whether you want CI/test commands added.

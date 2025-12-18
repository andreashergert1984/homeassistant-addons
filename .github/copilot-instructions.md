## Repo purpose (big picture)
This repository contains Home Assistant Supervisor "add-on" source folders. Each top-level folder is an independent add-on that builds a container image for Home Assistant Supervisor.

Add-ons in this repo:
- `odoo-ha-addon`: Odoo 18 with embedded PostgreSQL, using supervisord to run both processes. All state in `/data` for host mapping.
- `minio-ha-addon`: MinIO S3-compatible object storage with configurable credentials. Single-process container.
- `gitlab-ce`: GitLab Community Edition with volume mappings for `/etc/gitlab`, `/var/opt/gitlab`, `/var/log/gitlab`.
- `gitlab-runner-ha-addon`: GitLab Runner with dynamic registration via `/data/options.json`. Requires `docker_api: true` for Docker executor.
- `echo-server-ha-addon`: Simple Python Flask echo server for testing HTTP requests/responses.
- `jitsi-meet-ha-addon`: Full Jitsi Meet video conferencing with Prosody, Jicofo, JVB. Multi-process via supervisord.

## Architecture & startup flow (read these files)
### Odoo add-on (multi-process with supervisord)
- `odoo-ha-addon/Dockerfile` — base image, packages, copies `run.sh`/`start_postgres.sh`, uses `supervisord` as ENTRYPOINT.
- `odoo-ha-addon/supervisord.conf` — starts `postgres` and `odoo` programs, logs to `/data/*.log`.
- `odoo-ha-addon/start_postgres.sh` — initializes PostgreSQL in `/data/postgres` (`initdb` as `odoo` user), starts postgres.
- `odoo-ha-addon/run.sh` — waits for PostgreSQL readiness, renders `/etc/odoo/odoo.conf` from template, execs `odoo-bin`.
- `odoo-ha-addon/config.yaml` — add-on manifest with options, ports, `map_data: true` semantics.

### MinIO add-on (single-process)
- `minio-ha-addon/run.sh` — ENTRYPOINT that reads `/data/options.json` via `jq`, sets `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, execs `minio server`.
- Data path flexible: `/media/${MINIO_DATA_PATH}` or `/data/${MINIO_DATA_PATH}` based on `data_base` option.

### GitLab CE add-on (omnibus container)
- `gitlab-ce/Dockerfile` — multi-stage build copying from `gitlab/gitlab-ce:latest`, uses `/assets/init-container` as CMD.
- `gitlab-ce/config.yaml` — uses `map:` directive with `addon_config`, `data`, and `backup` types. Includes `backup_pre`/`backup_post` hooks for GitLab backups.

### GitLab Runner add-on (dynamic registration)
- `gitlab-runner-ha-addon/run.sh` — reads options (gitlab_url, registration_token, runner_tags, executor, docker_image) from `/data/options.json`, registers runner if `/data/config.toml` missing, then runs `gitlab-runner run`.
- Requires `docker_api: true` and `cap_add: [SYS_ADMIN, NET_ADMIN]` for Docker executor.

### Echo Server add-on (minimal Python Flask)
- `echo-server-ha-addon/server.py` — Flask app that echoes all request details (method, path, headers, body).
- `echo-server-ha-addon/run.sh` — simple wrapper that execs `python3 /server.py --port $PORT`.

### Jitsi Meet add-on (web interface)
- `jitsi-meet-ha-addon/Dockerfile` — uses nginx:alpine base, serves static HTML with embedded Jitsi Meet API.
- `jitsi-meet-ha-addon/index.html` — web interface that embeds meet.jit.si using External API.
- `jitsi-meet-ha-addon/run.sh` — simple startup script that launches nginx.
- Note: This add-on provides a web frontend to meet.jit.si, not a self-hosted Jitsi infrastructure.

## Developer workflows & useful commands (concrete examples)
### Odoo add-on
- Build: `docker build -t odoo-ha-addon:local ./odoo-ha-addon`
- Run with data mount: `mkdir -p /tmp/odoo-data && docker run --rm -it -p 8069:8069 -v /tmp/odoo-data:/data odoo-ha-addon:local`
- Logs: `docker logs -f <container-id>` or inspect `/tmp/odoo-data/{odoo,postgres,supervisor}.log`
- Local Python dev (no Docker): `python3 -m venv .venv && source .venv/bin/activate && pip install -r odoo-ha-addon/requirements.txt`, then run `odoo-bin -c /path/to/odoo.conf`

### MinIO add-on
- Build: `docker build -t minio-ha-addon:local ./minio-ha-addon`
- Run: `mkdir -p /tmp/minio-data && docker run --rm -it -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=minio123 -v /tmp/minio-data:/data minio-ha-addon:local`
- Console: `http://localhost:9001` (admin/minio123)
- Test S3: use `mc` or any S3 SDK at `http://localhost:9000`

### GitLab CE add-on
- Build: `docker build -t gitlab-ce:local ./gitlab-ce`
- Run: `docker run --rm -it -p 1280:80 -p 5050:5050 -v /tmp/gitlab-config:/etc/gitlab -v /tmp/gitlab-data:/var/opt/gitlab -v /tmp/gitlab-logs:/var/log/gitlab gitlab-ce:local`
- Access: `http://localhost:1280` (initial root password in `/etc/gitlab/initial_root_password`)

### GitLab Runner add-on
- Build: `docker build -t gitlab-runner-ha-addon:local ./gitlab-runner-ha-addon`
- Run: Create `/tmp/runner-data/options.json` with `{"gitlab_url":"https://gitlab.com/","registration_token":"YOUR_TOKEN","runner_tags":"ha","executor":"shell","docker_image":"alpine:latest"}`, then `docker run --rm -it -v /tmp/runner-data:/data -v /var/run/docker.sock:/var/run/docker.sock gitlab-runner-ha-addon:local`
- For Docker executor: must mount Docker socket and use `docker_api: true` in config.yaml

### Echo Server add-on
- Build: `docker build -t echo-server-ha-addon:local ./echo-server-ha-addon`
- Run: `docker run --rm -it -p 8080:8080 echo-server-ha-addon:local`
- Test: `curl -X POST http://localhost:8080/test -H "X-Custom: Header" -d '{"key":"value"}'`

### Jitsi Meet add-on
- Build: `docker build -t jitsi-meet-ha-addon:local ./jitsi-meet-ha-addon`
- Run: `docker run --rm -it -p 8000:80 jitsi-meet-ha-addon:local`
- Access: `http://localhost:8000` — enter a room name and start video conferencing
- Note: Requires internet connection to meet.jit.si for actual video conferencing

## Project-specific conventions and gotchas
- **Add-on layout**: each add-on must contain `config.yaml` and `Dockerfile`. Home Assistant Supervisor expects `map_data`, `map_config`, or `map:` directives in `config.yaml`.
- **Options reading**: all add-ons read `/data/options.json` (parsed via `jq`) for user-configurable settings. Schema validation happens in `config.yaml`.
- **Multi-process pattern** (Odoo only): uses `supervisord` as ENTRYPOINT/PID 1, manages both PostgreSQL and Odoo. Other add-ons are single-process.
- **Embedded Postgres** (Odoo): default `run.sh` assumes `db_host = 127.0.0.1`. Override DB connection via add-on options for external database.
- **Permission/ownership**: Odoo scripts use `su - odoo` and files in `/data` owned by `odoo:odoo`. When debugging, check ownership.
- **GitLab backup hooks**: `gitlab-ce/config.yaml` defines `backup_pre` and `backup_post` commands that run GitLab's native backup tool.
- **GitLab Runner registration**: `gitlab-runner-ha-addon/run.sh` checks for `/data/config.toml` — if missing, registers runner using options. Re-registration requires deleting this file.
- **Docker executor requirements**: GitLab Runner needs `docker_api: true`, `cap_add: [SYS_ADMIN, NET_ADMIN]`, and `apparmor=unconfined` to run Docker-based pipelines.

## Integration points & external dependencies
- Home Assistant Supervisor — add-on manifest (`config.yaml`) fields (ports, map_data/map_config) are meaningful only in Supervisor context.
- External network: Odoo expects port 8069; `ODOO_EXTERNAL_URL` in `config.yaml` is a useful hint but not enforced in code.
- Source of truth for Odoo: the `odoo` source is cloned in the Dockerfile from upstream Git (branch `18.0`). If you change code, prefer mounting `/data/addons` for custom modules.

## What to inspect when answering or editing code
- **Lifecycle scripts**: always check `run.sh`, `start_postgres.sh` (Odoo), or equivalent entrypoint scripts — they contain templating, wait logic, and ownership handling.
- **Logs**: for Odoo, check `/data/{odoo,postgres,supervisor}.log`. For other add-ons, use `docker logs`.
- **Options schema**: reference `config.yaml` schema section when adding new options. Keep `map_data: true` if option affects persisted data.
- **Dependencies**: Odoo's `pip install -r requirements.txt || true` pattern means build failures may be silent — verify runtime package availability.
- **GitLab volumes**: GitLab CE uses `map:` directive with three volume types (`addon_config`, `data`, `backup`) instead of simple `map_data`.
- **Runner config**: GitLab Runner stores registration in `/data/config.toml` — presence of this file determines whether `gitlab-runner register` runs.

## Examples to copy into suggestions
- To suggest a runtime check: "Tail the supervisor log at `/data/supervisor.log` (inside the running container or in mapped host dir)."
- To suggest adding a new env option: reference `odoo-ha-addon/config.yaml` and keep `map_data: true` if the option affects persisted data.

## Closing / feedback
This file lives at `.github/copilot-instructions.md`. If any sections are unclear or you'd like more examples (for `gitlab-ce/` or other add-ons), tell me which add-on to inspect next and whether you want CI/test commands added.

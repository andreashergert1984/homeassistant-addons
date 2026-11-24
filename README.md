# Andis Home Assistant Add-ons

Add-ons for Home Assistant OS and Supervised installations.

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fandreashergert1984%2Fhomeassistant-addons)

Or manually: **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, add
`https://github.com/andreashergert1984/homeassistant-addons`.

## Add-ons

| Add-on | What it does | Architectures |
| --- | --- | --- |
| [Hausmeister](hausmeister-ha-addon/README.md) | Smart home tickets that Claude Code drafts and, after your approval, implements: with backups, watches and one-click rollback. English and German UI. | amd64, aarch64 |
| [Yuvomi Family Planner](yuvomi-ha-addon/README.md) | Self-hosted family planner (tasks, calendar, budget, meals, shopping) plus a pantry scan terminal. | amd64, aarch64 |
| [Garage S3 Object Storage](garage-ha-addon/) | Lightweight S3-compatible object storage (Garage) with a web UI for buckets and keys. | amd64, aarch64 |
| [MinIO Object Storage](minio-ha-addon/) | S3-compatible object storage server. | amd64, aarch64, armv7 |
| [GitLab CE](gitlab-ce/) | Self-hosted GitLab Community Edition. | amd64 |
| [GitLab Runner](gitlab-runner-ha-addon/) | GitLab Runner for the Home Assistant Supervisor. | amd64, aarch64, armv7 |
| [Jitsi Meet](jitsi-meet-ha-addon/) | Self-hosted video conferencing (Prosody, Jicofo, JVB, Web). | amd64, aarch64 |
| [Odoo 18](odoo-ha-addon/) | Odoo with an embedded PostgreSQL, data in the add-on volume. | amd64 |
| [Echo Server](echo-server-ha-addon/) | Replies with the request data and headers, for debugging proxies and ingress. | amd64, aarch64, armv7 |

## Hausmeister

![Hausmeister board](https://raw.githubusercontent.com/andreashergert1984/homeassistant-addons/main/hausmeister-ha-addon/images/board.png)

Collect wishes and problems on a todo list, by voice or from automations. Claude Code, logged in inside the
add-on, writes a read-only draft; you approve it, and it is implemented with a snapshot before and watches
after. [More](hausmeister-ha-addon/README.md)

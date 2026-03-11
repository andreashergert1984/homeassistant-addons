# Garage S3 Object Storage

[![GitHub Release][release-shield]][release] [![License][license-shield]][license]

A lightweight, S3-compatible object storage server for Home Assistant, powered by [Garage](https://garagehq.deuxfleurs.fr/) — a self-hosted, Rust-based alternative to MinIO designed to run reliably on commodity hardware.

## Features

- **S3-compatible API** — works with any S3 client (AWS CLI, rclone, MinIO Client, SDKs, …)
- **Web UI** — manage buckets, access keys, and browse objects from your browser
- **Auto-initialisation** — cluster layout is configured automatically on first start
- **Persistent RPC secret** — auto-generated and stored; survives restarts and upgrades
- **Configurable storage** — use HA's `/media` or `/data` volume
- **Zstd compression** — optional object compression to save storage
- **Multi-architecture** — supports `amd64` and `aarch64`

## Installation

1. Navigate to **Settings → Add-ons → Add-on Store** in Home Assistant.
2. Click the menu (⋮) → **Repositories** and add:
   ```
   https://github.com/andreashergert1984/homeassistant-addons
   ```
3. Find **Garage S3 Object Storage** and click **Install**.
4. Set at least the **Admin Token** before starting.
5. Click **Start**.

## Quick start

After the add-on starts, open the **Web UI** tab (or navigate to `http://<ha-ip>:3909`).

**Create a bucket and access key via CLI** (exec into the container or use the Web UI):

```bash
# Create a bucket
garage bucket create my-bucket

# Create an S3 access key
garage key create my-app

# Grant read/write access
garage bucket allow --read --write my-bucket --key my-app

# Show credentials
garage key info my-app
```

Use the printed `Key ID` and `Secret key` with any S3 client pointing to
`http://<ha-ip>:3900` with region `garage` (or whatever you configured).

## S3 client example (AWS CLI)

```bash
aws --endpoint-url http://<ha-ip>:3900 \
    --region garage \
    s3 ls

aws --endpoint-url http://<ha-ip>:3900 \
    --region garage \
    s3 cp myfile.txt s3://my-bucket/
```

## Documentation

See [DOCS.md](DOCS.md) for the full configuration reference.

---

[release-shield]: https://img.shields.io/github/release/andreashergert1984/homeassistant-addons.svg
[release]: https://github.com/andreashergert1984/homeassistant-addons/releases
[license-shield]: https://img.shields.io/github/license/andreashergert1984/homeassistant-addons.svg
[license]: https://github.com/andreashergert1984/homeassistant-addons/blob/main/LICENSE

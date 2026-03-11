# Garage S3 — Full Documentation

## Overview

This add-on runs [Garage](https://garagehq.deuxfleurs.fr/) v1.0.x — a lightweight,
S3-compatible object storage server written in Rust. Garage is designed for self-hosted
deployments on commodity hardware and is an excellent drop-in replacement for MinIO.

Alongside the storage server, this add-on optionally starts
[garage-webui](https://github.com/khairul169/garage-webui) — a community Web UI that
lets you manage buckets, access keys, and browse stored objects without the CLI.

## Processes

The add-on runs three processes under supervisord:

| Process | Description |
|---|---|
| `garage server` | Main object storage daemon |
| `init_garage.sh` | One-shot first-run cluster initialisation |
| `garage-webui` | Web UI (optional, enabled by default) |

## Configuration reference

### `admin_token` (required)
Password protecting the Garage admin API. The Web UI uses this token to authenticate.
**Change this before exposing the add-on externally.**

### `rpc_secret` (optional)
64-character hex string used to authenticate RPC communication between cluster nodes.
Leave empty to auto-generate a secret that is stored in `/data/garage/.rpc_secret` and
reused across restarts. If you provide a value it must be exactly 64 hex characters
(`openssl rand -hex 32` generates a suitable value).

### `s3_region`
Region label returned to S3 clients. Any string is valid. Must match what you configure
in client applications. Default: `garage`.

### `data_base` / `data_path`
Controls where Garage stores metadata and object data:

| `data_base` | Resolved path |
|---|---|
| `media` | `/media/<data_path>` |
| `data`  | `/data/<data_path>`  |

Default: `media` / `garage` → `/media/garage`.

The directory is created automatically on first start. Two sub-directories are used:
- `meta/` — indexes and node state (benefits from SSD)
- `data/` — object blocks (HDD is fine)

### `s3_port`
TCP port for the S3-compatible API. Default: `3900`.

Configure your S3 clients to use `http://<ha-ip>:<s3_port>`.

### `admin_port`
TCP port for the Garage admin API. Default: `3903`.
This port is **bound to loopback only** and is never accessible outside the container.
The Web UI communicates with this port internally.

### `webui_port`
TCP port for the Garage Web UI. Default: `3909`.

### `webui_enabled`
Set to `false` to disable the Web UI. Default: `true`.

### `node_zone`
Availability zone label for this node (e.g. `dc1`, `home`, `rack1`). Default: `dc1`.
Only relevant for multi-node clusters — use the same value for all nodes in the same
physical location.

### `node_capacity_gb`
Advertised storage capacity in gigabytes. Default: `100`.
Garage uses this value to balance data placement in multi-node clusters. Set it close
to the actual free space on the volume you're using for `data_path`.

### `compression_level`
Zstd compression applied to stored object blocks. Default: `1`.

| Value | Meaning |
|---|---|
| `0`  | Disabled (no CPU overhead, larger storage footprint) |
| `1`  | Fast compression (recommended default) |
| `3`  | Balanced |
| `9`  | Maximum compression (higher CPU usage) |

### `log_level`
Log verbosity. Options: `error`, `warn`, `info`, `debug`, `trace`. Default: `info`.
Use `debug` or `trace` only for troubleshooting — output is very verbose.

---

## First-run initialisation

On the very first start, the `init_garage.sh` script:

1. Waits for the Garage server to accept requests.
2. Reads the node ID from `garage status`.
3. Assigns the node to the configured zone and capacity (`garage layout assign`).
4. Applies the layout (`garage layout apply --version 1`).
5. Creates a flag file `/data/garage/.cluster_initialized` to skip this on future starts.

This process is automatic and requires no user action.

---

## Using the S3 API

### Endpoint

```
http://<ha-ip>:<s3_port>
```

### Required client settings

| Setting | Value |
|---|---|
| Endpoint | `http://<ha-ip>:3900` |
| Region | value of `s3_region` (default: `garage`) |
| Access key ID | from `garage key info <name>` |
| Secret key | from `garage key info <name>` |
| Path-style access | **enabled** (required — Garage does not use virtual-hosted style by default) |

### AWS CLI

```bash
export AWS_ACCESS_KEY_ID=<key-id>
export AWS_SECRET_ACCESS_KEY=<secret>

aws --endpoint-url http://<ha-ip>:3900 \
    --region garage \
    s3 ls

aws --endpoint-url http://<ha-ip>:3900 \
    --region garage \
    s3 cp localfile.txt s3://my-bucket/
```

### rclone

```ini
[garage]
type = s3
provider = Other
access_key_id = <key-id>
secret_access_key = <secret>
region = garage
endpoint = http://<ha-ip>:3900
force_path_style = true
```

---

## Managing Garage via CLI

The `garage` binary is available inside the container. Use the Home Assistant CLI or
SSH add-on to exec into the container:

```bash
# Bucket management
garage bucket create <name>
garage bucket list
garage bucket info <name>
garage bucket delete <name>

# Access key management
garage key create <name>
garage key list
garage key info <name>
garage key delete <name>

# Grant/revoke bucket permissions
garage bucket allow  --read --write --owner <bucket> --key <key-name>
garage bucket deny   --read --write <bucket> --key <key-name>

# Cluster status
garage status
garage layout show
garage stats
```

---

## Upgrading Garage

To upgrade to a newer Garage version, update the `GARAGE_VERSION` build argument in
`build.json` and rebuild the add-on. Data is stored in `/media/garage` (or
`/data/garage`) and is preserved across upgrades.

---

## Troubleshooting

### Web UI shows "connection refused"
The Web UI connects to the admin API on port 3903 (loopback). Ensure the `admin_token`
in the add-on configuration matches the token garage was started with. Restarting the
add-on regenerates `garage.toml` with the current options.

### "Cluster not initialised" errors
If the flag file `/data/garage/.cluster_initialized` was removed or the init script
failed, you can re-run initialisation by:
1. Stopping the add-on.
2. Deleting `/data/garage/.cluster_initialized` (if it exists).
3. Starting the add-on again.

### Cannot upload objects / "no node available"
Verify that the cluster layout has been applied:
```bash
garage layout show
```
The output should show your node with an assigned zone and capacity. If it is empty,
delete the init flag and restart the add-on (see above).

### Logs
Check the add-on log in the Home Assistant UI. Increase `log_level` to `debug` for
more detail from the Garage server.

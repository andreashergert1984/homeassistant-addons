# MinIO Home Assistant Add-on

High-performance S3-compatible object storage server for Home Assistant.

## About

MinIO is a high-performance, S3-compatible object storage system. This add-on runs MinIO inside Home Assistant Supervisor, allowing you to:

- Store backups and media files
- Provide S3-compatible storage for applications
- Manage objects via Web Console or S3 API
- Use configurable data paths (default: `/media/minio`)

## Installation

1. Copy this folder to your Home Assistant add-ons local repository
2. Refresh the Add-on Store
3. Install "MinIO Object Storage"
4. Configure your admin credentials in the add-on options
5. Start the add-on
6. Access the console at `http://<home-assistant-host>:9001`


## Configuration

### Options

- `admin_user` (string, required): MinIO root username (default: `admin`)
- `admin_password` (password, required): MinIO root password - **change this!**
- `data_path` (string): Subdirectory for MinIO storage (default: `minio`)
- `data_base` (media|data): Base directory for MinIO data, either `/media` or `/data` (default: `media`)
- `browser_enabled` (boolean): Enable web console access (default: `true`)


### Example Configuration

```yaml
admin_user: minio-admin
admin_password: MySecurePassword123!
data_path: minio
data_base: media
api_port: 9200
console_port: 9201
browser_enabled: true
```

### Custom Port Mapping Example

If host ports 9000/9001 are in use, you can map MinIO's internal ports to other host ports:

```bash
docker run --rm -it \
	-p 9200:9200 -p 9201:9201 \
	-e MINIO_ROOT_USER=admin \
	-e MINIO_ROOT_PASSWORD=minio123 \
	-v /tmp/minio-data:/media/minio \
	minio-ha-addon:local
```
Set in add-on options:
```yaml
api_port: 9200
console_port: 9201
```


## Usage

1. **Web Console**: Access at `http://<host-ip>:<console-port>` with your admin credentials
2. **S3 API**: Connect S3 clients to `http://<host-ip>:<api-port>`
3. **Create Buckets**: Use the web console to create buckets for organizing your data


## Data Storage

By default, MinIO data is stored at `/media/minio` inside the container, which maps to the Home Assistant media volume. You can configure an alternative path using the `data_path` and `data_base` options.

The add-on supports:
- `map_data: true` - allows storage in `/data`
- `map_media: true` - allows storage in `/media`

Set `data_base: media` to use `/media/<data_path>`, or `data_base: data` to use `/data/<data_path>`.

## Support

For issues specific to this Home Assistant add-on, please open an issue in the repository.
For MinIO documentation, visit: https://min.io/docs/minio/linux/index.html

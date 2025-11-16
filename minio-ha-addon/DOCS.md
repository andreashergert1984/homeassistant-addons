# Configuration

## Options

### Option: `admin_user`

The root username for MinIO administration.

**Default**: `admin`

### Option: `admin_password`

The root password for MinIO administration. **You must change this from the default value!**

MinIO requires passwords to be at least 8 characters long.

**Default**: `changeme123`


### Option: `data_path`

The subdirectory under the selected base directory (`/media` or `/data`) where MinIO will store objects and metadata.

**Default**: `minio`

For example, setting `data_path: minio` and `data_base: media` stores data at `/media/minio` inside the container.

### Option: `data_base`

Selects the base directory for MinIO data storage. Can be either `media` (for `/media`) or `data` (for `/data`).

**Default**: `media`

For example, setting `data_base: data` and `data_path: minio` stores data at `/data/minio`.

### Option: `browser_enabled`

Enable or disable the MinIO web console.

**Default**: `true`

Set to `false` to disable web console access (API-only mode).

## Ports

- **9000**: MinIO S3 API endpoint
- **9001**: MinIO Web Console (if enabled)


## Data Persistence

All MinIO data is persisted in the Home Assistant managed volume. The add-on uses:

- `/media/<data_path>` for object storage (default)
- `/data/<data_path>` if `data_base: data` is selected
- `/config` for configuration (if needed)

## Using MinIO with Applications

### S3 Configuration

Use these settings to connect S3-compatible applications:

- **Endpoint**: `http://<home-assistant-host>:9000`
- **Access Key**: Your `admin_user`
- **Secret Key**: Your `admin_password`
- **Region**: `us-east-1` (or leave blank)

### Example: Python boto3

```python
import boto3

s3 = boto3.client(
    's3',
    endpoint_url='http://homeassistant.local:9000',
    aws_access_key_id='admin',
    aws_secret_access_key='your-password',
    region_name='us-east-1'
)

# List buckets
response = s3.list_buckets()
print([bucket['Name'] for bucket in response['Buckets']])
```

### Example: MinIO Client (mc)

```bash
mc alias set ha-minio http://homeassistant.local:9000 admin your-password
mc mb ha-minio/my-bucket
mc cp file.txt ha-minio/my-bucket/
```

## Security Notes

1. **Change the default password** before exposing the add-on to a network
2. Consider using Home Assistant's Ingress feature for secure access
3. MinIO supports TLS - consider adding reverse proxy for HTTPS
4. Create separate access keys for applications (via web console) instead of using root credentials

## Troubleshooting

### Cannot access web console

- Verify port 9001 is not blocked
- Check `browser_enabled` is set to `true`
- Review add-on logs for errors

### S3 operations fail

- Verify credentials match your configuration
- Check port 9000 is accessible
- Ensure bucket names follow S3 naming rules (lowercase, no underscores)

### Data not persisting

- Verify the add-on has `map_data: true` enabled
- Check filesystem permissions on the host
- Review add-on logs during startup

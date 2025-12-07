# GitLab Runner Add-on Documentation

This add-on runs a GitLab Runner inside Home Assistant Supervisor. Configure it with your registration token and GitLab URL to register the runner automatically on first start.

## Options
- `registration_token`: GitLab registration token
- `gitlab_url`: GitLab instance URL
- `runner_tags`: Tags for the runner
- `executor`: Executor type (shell, docker, etc.)

## Data
All persistent data is stored in `/data`.

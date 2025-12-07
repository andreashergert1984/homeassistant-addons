# GitLab Runner Home Assistant Add-on

This add-on provides a GitLab Runner instance for use with Home Assistant Supervisor. It allows you to run CI/CD pipelines from your GitLab instance.

## Configuration
- `registration_token`: Your GitLab project/group runner registration token.
- `gitlab_url`: The URL of your GitLab instance.
- `runner_tags`: Tags to assign to this runner.
- `executor`: Runner executor type (default: shell).

## Data Persistence
All runner configuration and logs are stored under `/data`.

## Usage
1. Build the add-on locally:
   ```bash
   docker build -t gitlab-runner-ha-addon:local ./gitlab-runner-ha-addon
   ```
2. Run the container:
   ```bash
   mkdir -p /tmp/gitlab-runner-data && \
   docker run --rm -it -v /tmp/gitlab-runner-data:/data gitlab-runner-ha-addon:local
   ```

#!/bin/bash
set -e
CONFIG_PATH="/data/config.toml"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Registering GitLab Runner..."
  gitlab-runner register \
    --non-interactive \
    --url "$GITLAB_URL" \
    --registration-token "$REGISTRATION_TOKEN" \
    --executor "$EXECUTOR" \
    --tag-list "$RUNNER_TAGS" \
    --config "$CONFIG_PATH"
fi

gitlab-runner run --config "$CONFIG_PATH"

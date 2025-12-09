#!/bin/bash
set -e
CONFIG_PATH="/data/config.toml"
OPTIONS_PATH="/data/options.json"

# Debug: Show options.json content (always print first)
echo "===== /data/options.json content ====="
cat "$OPTIONS_PATH" || echo "(Could not read $OPTIONS_PATH)"
echo "======================================"

# Read options from Home Assistant
if [ -f "$OPTIONS_PATH" ]; then
  GITLAB_URL=$(jq -r '.gitlab_url' "$OPTIONS_PATH")
  REGISTRATION_TOKEN=$(jq -r '.registration_token' "$OPTIONS_PATH")
  RUNNER_TAGS=$(jq -r '.runner_tags' "$OPTIONS_PATH")
  EXECUTOR=$(jq -r '.executor' "$OPTIONS_PATH")
  DOCKER_IMAGE=$(jq -r '.docker_image' "$OPTIONS_PATH")
else
  echo "ERROR: $OPTIONS_PATH not found!"
  exit 1
fi

# Debug: Show loaded variables (always print before any logic)
echo "GITLAB_URL: $GITLAB_URL"
echo "REGISTRATION_TOKEN: $REGISTRATION_TOKEN"
echo "RUNNER_TAGS: $RUNNER_TAGS"
echo "EXECUTOR: $EXECUTOR"
echo "DOCKER_IMAGE: $DOCKER_IMAGE"

if [ -z "$GITLAB_URL" ] || [ "$GITLAB_URL" = "null" ]; then
  echo "ERROR: gitlab_url is not set!"
  exit 1
fi
if [ -z "$REGISTRATION_TOKEN" ] || [ "$REGISTRATION_TOKEN" = "null" ]; then
  echo "ERROR: registration_token is not set!"
  exit 1
fi

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Registering GitLab Runner..."
  if [ "$EXECUTOR" = "docker" ]; then
    gitlab-runner register \
      --non-interactive \
      --url "$GITLAB_URL" \
      --registration-token "$REGISTRATION_TOKEN" \
      --executor "$EXECUTOR" \
      --docker-image "$DOCKER_IMAGE" \
      --tag-list "$RUNNER_TAGS" \
      --config "$CONFIG_PATH"
  else
    gitlab-runner register \
      --non-interactive \
      --url "$GITLAB_URL" \
      --registration-token "$REGISTRATION_TOKEN" \
      --executor "$EXECUTOR" \
      --tag-list "$RUNNER_TAGS" \
      --config "$CONFIG_PATH"
  fi
fi

gitlab-runner run --config "$CONFIG_PATH"

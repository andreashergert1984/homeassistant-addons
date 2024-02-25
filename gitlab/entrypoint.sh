#!/bin/bash
set -e

# Perform any pre-start configuration here
# For example, dynamically setting external_url based on environment variables
# echo "external_url '${GITLAB_EXTERNAL_URL}'" >> /etc/gitlab/gitlab.rb

# Now reconfigure GitLab to apply our configurations
gitlab-ctl reconfigure

# Hand off to the original entrypoint
exec /opt/gitlab/bin/gitlab-ctl "$@"

#!/bin/bash

# Dynamically set the external_url to match the Ingress path
GITLAB_EXTERNAL_URL="http://$(hostname -i)"
echo $GITLAB_EXTERNAL_URL
echo "starting current version"
echo "external_url '${GITLAB_EXTERNAL_URL}'" >> /etc/gitlab/gitlab.rb

# Configure trusted proxies and other settings as needed
echo "nginx['listen_port'] = 80;" >> /etc/gitlab/gitlab.rb
echo "nginx['listen_https'] = false;" >> /etc/gitlab/gitlab.rb
echo "gitlab_rails['trusted_proxies'] = ['172.30.32.2']" >> /etc/gitlab/gitlab.rb
echo "gitlab_rails['initial_root_password'] = '<my_strong_password>'" >> /etc/gitlab/gitlab.rb



# Reconfigure GitLab to apply changes
#gitlab-ctl reconfigure

/assets/wrapper
# Execute the Docker CMD
#exec "$@"

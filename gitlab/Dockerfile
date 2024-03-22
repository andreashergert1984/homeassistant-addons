FROM gitlab/gitlab-ce:latest
#LABEL maintainer="your-email@example.com"
# Set GitLab to be aware it's behind a proxy
#ENV GITLAB_OMNIBUS_CONFIG="external_url 'https://your-home-assistant-domain.com/'; gitlab_rails['trusted_proxies'] = ['your-proxy-IP']; nginx['listen_port'] = 80; nginx['listen_https'] = false;"


RUN cp /opt/gitlab/etc/gitlab.rb.template /etc/gitlab/gitlab.rb
# Start script (if you need to customize the entrypoint, otherwise optional)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]
#CMD ["gitlab-ctl", "reconfigure"]

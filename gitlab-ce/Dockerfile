FROM gitlab/gitlab-ce:latest AS gitlabsrc


FROM docker.io/ubuntu:24.04

COPY --from=gitlabsrc / /

SHELL ["/bin/sh", "-c"]

# Default to supporting utf-8
ENV LANG=C.UTF-8

# Resolve error: TERM environment variable not set.
ENV TERM=xterm

# Expose web & ssh
EXPOSE 443 80 22

# Define data volumes
# VOLUME ["/etc/gitlab", "/var/opt/gitlab", "/var/log/gitlab"]

# Wrapper to handle signal, trigger runit and reconfigure GitLab
CMD ["/assets/init-container"]

HEALTHCHECK --interval=60s --timeout=30s --retries=5 \
CMD /opt/gitlab/bin/gitlab-healthcheck --fail --max-time 10

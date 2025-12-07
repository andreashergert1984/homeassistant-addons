# GitLab Runner Home Assistant Add-on Dockerfile
FROM debian:bullseye-slim

RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -L https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh | bash && \
    apt-get install -y gitlab-runner && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY run.sh /run.sh
RUN chmod +x /run.sh

ENTRYPOINT ["/run.sh"]

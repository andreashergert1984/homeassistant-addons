FROM gitlab/gitlab-ce:latest
LABEL maintainer="Your Name <your-email@example.com>"

# Use this section to install dependencies or run any custom commands
# RUN apt-get update && apt-get install -y your-dependencies-here

# Expose ports (GitLab HTTP and HTTPS)
EXPOSE 80 443

# Initialize script (customize if needed)
CMD ["gitlab-ctl", "reconfigure"]

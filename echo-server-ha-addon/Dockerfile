# Echo Server Home Assistant Add-on Dockerfile
FROM python:3.11-slim

RUN pip install flask

COPY server.py /server.py
COPY run.sh /run.sh
RUN chmod +x /run.sh

ENTRYPOINT ["/run.sh"]

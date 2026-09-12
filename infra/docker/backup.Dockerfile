# syntax=docker/dockerfile:1
FROM postgres:18.6-alpine
RUN apk add --no-cache age
COPY infra/docker/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
USER postgres
ENTRYPOINT ["/bin/sh", "-c", "while true; do /usr/local/bin/backup.sh; sleep 86400; done"]

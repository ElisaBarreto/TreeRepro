# syntax=docker/dockerfile:1
FROM postgres:18.6-alpine@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b
RUN apk add --no-cache age curl
COPY infra/docker/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
# Pre-create the backup directory so a fresh named volume inherits postgres
# ownership; otherwise Docker creates the mount point root-owned and the
# non-root process cannot write (docs/gotchas/docker.md).
RUN mkdir -p /backups && chown postgres:postgres /backups
VOLUME ["/backups"]
USER postgres
# A failed backup exits the container non-zero so `docker compose ps` shows it
# (compose.prod.yml restarts it with `on-failure`).
ENTRYPOINT ["/bin/sh", "-c", "while /usr/local/bin/backup.sh; do sleep 86400; done; exit 1"]

# syntax=docker/dockerfile:1
FROM postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
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

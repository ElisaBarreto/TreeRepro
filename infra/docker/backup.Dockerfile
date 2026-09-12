# syntax=docker/dockerfile:1
FROM postgres:18.6-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2
RUN apk add --no-cache age
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

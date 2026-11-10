# syntax=docker/dockerfile:1
FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
# pnpm, pinned by version and by the sha512 of its native build
# (docs/gotchas/docker.md "Bumping pnpm").
COPY infra/docker/install-pnpm.sh /tmp/install-pnpm.sh
RUN sh /tmp/install-pnpm.sh && rm /tmp/install-pnpm.sh
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY tools/rfc-lint/package.json tools/rfc-lint/
COPY apps/e2e/package.json apps/e2e/
RUN pnpm install --frozen-lockfile --filter "@treerepro/web..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @treerepro/contracts build && pnpm --filter @treerepro/web build

FROM caddy:2.11.7-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
# Pull Alpine security fixes the caddy image has not rebuilt with yet.
RUN apk upgrade --no-cache
# Run Caddy as a dedicated user (RFC-02 R10). The upstream image already ships
# /usr/bin/caddy with the cap_net_bind_service file capability, so the process
# binds 80/443 without root as long as compose keeps NET_BIND_SERVICE in the
# bounding set. /data, /config and /var/log/caddy (access log) are pre-owned so a fresh named volume inherits
# the ownership (docs/gotchas/docker.md); an existing root-owned volume needs
# the one-off chown documented there.
RUN addgroup -S -g 1000 caddy \
    && adduser -S -u 1000 -G caddy -H -h /nonexistent -s /sbin/nologin caddy \
    && mkdir -p /var/log/caddy \
    && chown -R caddy:caddy /data /config /var/log/caddy
COPY infra/docker/Caddyfile.prod /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv/web
VOLUME ["/data", "/config", "/var/log/caddy"]
USER caddy

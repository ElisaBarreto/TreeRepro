# syntax=docker/dockerfile:1
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
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

FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
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

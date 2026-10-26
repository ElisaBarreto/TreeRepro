# syntax=docker/dockerfile:1
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
# pnpm through corepack, pinned by version and by the sha512 of the npm tarball:
# corepack refuses a download whose hash differs (OpenSSF Scorecard flags any
# `npm install` as unpinned). pnpm 12's npm package is a launcher that fetches
# the native binary on first run, so run it once here and not at container
# start. Bump: docs/gotchas/docker.md "Bumping pnpm".
RUN corepack enable \
 && corepack prepare pnpm@12.4.2+sha512.08adc6613180275c7c9edada39dcf08c9c61ad4e7eaf330a4f3461f102b0f907423454d117f98e72d47fef0616070644d7bffc973a6a57f5090a6d7c368b07c9 --activate \
 && pnpm --version
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

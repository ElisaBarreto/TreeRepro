# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS build
# pnpm through corepack, pinned by version and by the sha512 of the npm tarball:
# corepack refuses a download whose hash differs (OpenSSF Scorecard flags any
# `npm install` as unpinned). pnpm 12's npm package is a launcher that fetches
# the native binary on first run, so run it once here and not at container
# start. Bump: docs/gotchas/docker.md "Bumping pnpm".
RUN corepack enable \
 && corepack prepare pnpm@12.4.1+sha512.2e81e399d73fe8390dab25e06aa788ab7a5908248d2f5a370f82b481147a6a7a367bf8048f9a6fdb6460f21a66f0542dedb8b94ca2c8723596741920b1656d4c --activate \
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

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
# Pull Alpine security fixes the caddy image has not rebuilt with yet.
RUN apk upgrade --no-cache
# Run Caddy as a dedicated user (RFC-02 R10). The upstream image already ships
# /usr/bin/caddy with the cap_net_bind_service file capability, so the process
# binds 80/443 without root as long as compose keeps NET_BIND_SERVICE in the
# bounding set. /data and /config are pre-owned so a fresh named volume inherits
# the ownership (docs/gotchas/docker.md); an existing root-owned volume needs
# the one-off chown documented there.
RUN addgroup -S -g 1000 caddy \
    && adduser -S -u 1000 -G caddy -H -h /nonexistent -s /sbin/nologin caddy \
    && chown -R caddy:caddy /data /config
COPY infra/docker/Caddyfile.prod /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv/web
VOLUME ["/data", "/config"]
USER caddy

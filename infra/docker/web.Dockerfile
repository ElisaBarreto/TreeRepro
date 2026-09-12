# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS build
RUN npm install -g pnpm@12.4.1
WORKDIR /workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY tools/rfc-lint/package.json tools/rfc-lint/
RUN pnpm install --frozen-lockfile --filter "@treerepro/web..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @treerepro/contracts build && pnpm --filter @treerepro/web build

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
# Pull Alpine security fixes the caddy image has not rebuilt with yet.
RUN apk upgrade --no-cache
COPY infra/docker/Caddyfile.prod /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv/web
VOLUME ["/data", "/config"]

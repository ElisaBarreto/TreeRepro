# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS base
# pnpm through corepack, pinned by version and by the sha512 of the npm tarball:
# corepack refuses a download whose hash differs (OpenSSF Scorecard flags any
# `npm install` as unpinned). pnpm 12's npm package is a launcher that fetches
# the native binary on first run, so run it once here and not at container
# start. Bump: docs/gotchas/docker.md "Bumping pnpm".
RUN corepack enable \
 && corepack prepare pnpm@12.4.1+sha512.2e81e399d73fe8390dab25e06aa788ab7a5908248d2f5a370f82b481147a6a7a367bf8048f9a6fdb6460f21a66f0542dedb8b94ca2c8723596741920b1656d4c --activate \
 && pnpm --version
WORKDIR /workspace

FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY tools/rfc-lint/package.json tools/rfc-lint/

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@treerepro/api..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @treerepro/contracts build && pnpm --filter @treerepro/api build

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@treerepro/api..."

FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS runtime
# Pull Alpine security fixes the node image has not rebuilt with yet, and drop
# the bundled npm, corepack and yarn: the runtime only executes `node dist/server.js`.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/apps/api/package.json ./apps/api/
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /workspace/apps/api/seed ./apps/api/seed
WORKDIR /workspace/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

# syntax=docker/dockerfile:1
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS base
# pnpm, pinned by version and by the sha512 of its native build
# (docs/gotchas/docker.md "Bumping pnpm").
COPY infra/docker/install-pnpm.sh /tmp/install-pnpm.sh
RUN sh /tmp/install-pnpm.sh && rm /tmp/install-pnpm.sh
WORKDIR /workspace

FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/config/package.json packages/config/
COPY tools/rfc-lint/package.json tools/rfc-lint/
COPY apps/e2e/package.json apps/e2e/

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter "@treerepro/api..."
COPY packages/config packages/config
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @treerepro/contracts build && pnpm --filter @treerepro/api build

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@treerepro/api..."

FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runtime
# Pull Alpine security fixes the node image has not rebuilt with yet, and drop
# the bundled npm: the runtime only executes `node dist/server.js`.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx
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
# RFC-82 R20: GET /api/docs and GET /api/docs/openapi.json read this at runtime.
COPY docs/api ./docs/api
WORKDIR /workspace/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2 AS base
RUN npm install -g pnpm@12.4.1
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
WORKDIR /workspace/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

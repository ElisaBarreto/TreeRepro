# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2
# pnpm through corepack, pinned by version and by the sha512 of the npm tarball:
# corepack refuses a download whose hash differs (OpenSSF Scorecard flags any
# `npm install` as unpinned). pnpm 12's npm package is a launcher that fetches
# the native binary on first run, so run it once here and not at container
# start. Bump: docs/gotchas/docker.md "Bumping pnpm".
RUN corepack enable \
 && corepack prepare pnpm@12.4.2+sha512.08adc6613180275c7c9edada39dcf08c9c61ad4e7eaf330a4f3461f102b0f907423454d117f98e72d47fef0616070644d7bffc973a6a57f5090a6d7c368b07c9 --activate \
 && pnpm --version
WORKDIR /workspace

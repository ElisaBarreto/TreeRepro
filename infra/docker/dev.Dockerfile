# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2
# pnpm through corepack, pinned by version and by the sha512 of the npm tarball:
# corepack refuses a download whose hash differs (OpenSSF Scorecard flags any
# `npm install` as unpinned). pnpm 12's npm package is a launcher that fetches
# the native binary on first run, so run it once here and not at container
# start. Bump: docs/gotchas/docker.md "Bumping pnpm".
RUN corepack enable \
 && corepack prepare pnpm@12.4.1+sha512.2e81e399d73fe8390dab25e06aa788ab7a5908248d2f5a370f82b481147a6a7a367bf8048f9a6fdb6460f21a66f0542dedb8b94ca2c8723596741920b1656d4c --activate \
 && pnpm --version
WORKDIR /workspace

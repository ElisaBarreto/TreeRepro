# syntax=docker/dockerfile:1
FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
# pnpm, pinned by version and by the sha512 of its native build
# (docs/gotchas/docker.md "Bumping pnpm").
COPY infra/docker/install-pnpm.sh /tmp/install-pnpm.sh
RUN sh /tmp/install-pnpm.sh && rm /tmp/install-pnpm.sh
WORKDIR /workspace

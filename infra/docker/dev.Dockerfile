# syntax=docker/dockerfile:1
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
# pnpm, pinned by version and by the sha512 of its native build
# (docs/gotchas/docker.md "Bumping pnpm").
COPY infra/docker/install-pnpm.sh /tmp/install-pnpm.sh
RUN sh /tmp/install-pnpm.sh && rm /tmp/install-pnpm.sh
WORKDIR /workspace

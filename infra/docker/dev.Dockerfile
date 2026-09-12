# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2
RUN npm install -g pnpm@12.4.1
WORKDIR /workspace

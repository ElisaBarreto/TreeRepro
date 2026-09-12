# syntax=docker/dockerfile:1
FROM node:26.8-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868
RUN npm install -g pnpm@12.4.1
WORKDIR /workspace

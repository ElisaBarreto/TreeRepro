# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine
RUN npm install -g pnpm@12.4.1
WORKDIR /workspace

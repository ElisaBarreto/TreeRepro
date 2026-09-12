# pnpm

## Ignored build scripts
**Symptom:** `pnpm install` prints "Ignored build scripts: …" and a native dependency does not work.
**Cause:** pnpm blocks postinstall scripts unless allowed.
**Fix:** `pnpm approve-builds`, pick the packages, commit the resulting `allowBuilds` entries in `pnpm-workspace.yaml` (pnpm 12's key for what older pnpm called `onlyBuiltDependencies`).

## Two `node_modules` worlds in development
**Symptom:** A package works on the host but not in `docker compose`, or vice versa.
**Cause:** Root `node_modules` inside containers is a named volume (`node-modules`), separate from the host's. Per-package `node_modules` directories on the bind mount contain relative symlinks that resolve in both.
**Fix:** After changing dependencies run `pnpm install` on the host and `docker compose run --rm deps` (or `docker compose up`, which re-runs `deps`). Never use `npm install` in this repo.

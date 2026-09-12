# pnpm

## Ignored build scripts
**Symptom:** `pnpm install` prints "Ignored build scripts: …" and a native dependency does not work.
**Cause:** pnpm blocks postinstall scripts unless allowed.
**Fix:** `pnpm approve-builds`, pick the packages, commit the resulting `allowBuilds` entries in `pnpm-workspace.yaml` (pnpm 12's key for what older pnpm called `onlyBuiltDependencies`).

## Two `node_modules` worlds in development
**Symptom:** A package works on the host but not in `docker compose`, or vice versa.
**Cause:** Root `node_modules` inside containers is a named volume (`node-modules`), separate from the host's. Per-package `node_modules` directories on the bind mount contain relative symlinks that resolve in both.
**Fix:** After changing dependencies run `pnpm install` on the host and `docker compose run --rm deps` (or `docker compose up`, which re-runs `deps`). Never use `npm install` in this repo.

## `pnpm install` rejects a version published this week
**Symptom:** `pnpm add foo@latest` or `pnpm install` fails with `ERR_PNPM_...MINIMUM_RELEASE_AGE...`, listing versions "within the minimumReleaseAge cutoff".
**Cause:** `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days). pnpm checks every entry in the lockfile, even with `--frozen-lockfile`, so a lockfile that pins a fresh release fails everywhere, CI included.
**Fix:** Wait for the version to age, or pick the previous one. For an urgent security patch add `name@exact.version` to `minimumReleaseAgeExclude` with a comment saying when it can be removed; pnpm prunes stale entries on the next lockfile rebuild. The list added on 2026-09-12 (versions already locked before the guard existed) can be deleted after 2026-09-18.

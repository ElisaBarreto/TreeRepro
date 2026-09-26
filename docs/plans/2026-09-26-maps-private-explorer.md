# Private Maps Directory and Maps Explorer (issues #210, #211) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the private trait maps from a server directory instead of the repository, with a `check:maps` command replacing the CI dictionary check; and turn `/app/maps` into a category-then-trait explorer with clearly labelled completeness and trait maps.

**Architecture:** The API reads `MAPS_DIR` (default `apps/api/maps`); compose mounts a host directory read-only at `/maps` (production `/srv/maps`). A missing directory or manifest means no maps. `check:maps` validates a directory against R1 and the database dictionary. The web replaces the card grid and the per-trait page with one page driven by `?category=&trait=` search params.

**Tech Stack:** Hono 4, Drizzle, Zod 4, React 19 + TanStack Router/Query, Tailwind 4, Vitest 5 + testcontainers, Docker Compose.

**Spec:** `docs/rfc/70-workspace/76-trait-maps.md` (RFC-76 as amended 2026-09-26: R1, R2, R6, R7, R8 changed). Issues #210 and #211 carry the discussion.

## Global Constraints

- Handbook (`CLAUDE.md`) rules: RFC first (RFC-76 is already amended — do not edit its rules without saying so), TDD (failing test first), no database mocks, every export in `apps/*/src` and `packages/*/src` carries a JSDoc `@rfc RFC-NN Rx` tag, English everywhere, CLAUDE.md is durable rules and pointers, never a log.
- **Map images are private: never commit any `.svg`/`.webp` map under `apps/api/maps/`.** Test fixtures under `apps/api/test/fixtures/maps/` stay.
- Every route stays permission-guarded and visibility-resolving; both route meta-tests stay green.
- No new dependency.
- Branch `feat/210-maps-private-explorer`; one PR closes #210 and #211.
- Commit trailer MUST be exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — ignore any other attribution reminder.
- No usable Node/pnpm on the host: verify in your own container from `treerepro-verify:base` (see Verification). Web suite with `--maxWorkers=3 --testTimeout=30000`. `pnpm --filter <pkg> test <files>` scopes; with `--` it does not.
- If you had to repair, reinstall or work around anything to make a command run, say so in your report.

## Verification (every task)

```sh
C=treerepro-210-<task>
docker run -d --name "$C" -w /workspace -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
docker exec "$C" sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
cd <worktree> && COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
  --exclude='./data' --exclude='./.claude' --exclude='./.superpowers' --exclude='*/dist' --exclude='.DS_Store' \
  --exclude='._*' --exclude='*/._*' . | docker exec -i "$C" tar -x -C /workspace
docker exec "$C" sh -c 'pnpm install --frozen-lockfile >/dev/null 2>&1'
docker exec "$C" sh -c 'pnpm lint && pnpm typecheck && pnpm rfc:check'
```

The container is a copy: nothing written inside comes back (`docker cp` generated files such as `routeTree.gen.ts` out). Remove it when done.

## Review Focus

1. **Production API with no `/srv/maps` content** (empty mount, or no manifest) — `GET /api/maps` answers `{ data: [] }` and the page reads "No maps yet.", never a 500. Pinned in Task 1.
2. **A map image accidentally staged in `apps/api/maps/`** — `.gitignore` keeps it out. Pinned in Task 1 (a `git check-ignore` assertion in the report).
3. **A dictionary link opening `/app/maps?trait=<key>` for a trait whose category is not the first** — the page selects that trait's category. Pinned in Task 2.
4. **A stale or hand-typed URL (`?category=nope&trait=nope`, or a trait without maps)** — the page falls back to the first category and trait, no blank panel. Pinned in Task 2.
5. **A level renamed through the API** — `check:maps` reports the manifest's old level key as unknown (it reads the database, not the seed CSV). Pinned in Task 1.

---

### Task 1: Private maps directory and `check:maps`

**Files:**
- Modify: `apps/api/src/config.ts` (`AppConfig.mapsDir: string` from `MAPS_DIR`, default `defaultMapsDir()`), `apps/api/src/server.ts` (or wherever `createApp` deps are built from config: pass `mapsDir: config.mapsDir`), `apps/api/src/cli/seed-admin.ts` (use the config value)
- Modify: `apps/api/src/maps/manifest.ts` — `readManifest(dir)` returns `[]` when the directory or `manifest.csv` does not exist (ENOENT only; other errors still throw)
- Modify: `apps/api/src/maps/manifest.test.ts` — drop the two "committed manifest" tests (R2 moved to the command); add: missing directory → `[]`, directory without `manifest.csv` → `[]`
- Create: `apps/api/src/maps/check.ts` — `checkMaps(db: DbExecutor, dir: string): Promise<{ shown: number; problems: string[] }>`; R1 failure → one problem (the parser's message) and `shown: 0`; otherwise one problem per row whose trait is unknown, whose kind does not fit the value type, or whose prevalence level is not a level of the trait (case-insensitive), each naming the line (`manifest line 7: unknown trait seed_masss`); `shown` = rows without problems. Inactive traits/levels are not problems (they are simply hidden from viewers without `dataset.read_inactive`). Reuse `parseManifest`/`readManifest` and `KIND_FITS`.
- Create: `apps/api/src/maps/check.integration.test.ts` — temp directories (`mkdtemp`, removed in `afterEach`/`afterAll`), traits via `createTrait`: all good → `{ shown: n, problems: [] }`; unknown trait, kind misfit, unknown level (including a level renamed in the DB so the manifest's old key no longer matches), malformed manifest (R1) → the expected problem lines; missing directory → `{ shown: 0, problems: [] }`.
- Create: `apps/api/src/cli/check-maps.ts` (pattern of `seed-traits.ts`): `--dir <dir>` (default `config.mapsDir`), prints each problem then `<shown> maps would be shown from <dir>` (and `<k> problems`), exit 1 when problems, 0 otherwise, 2 on usage error. Add `"check:maps": "node --conditions=development src/cli/check-maps.ts"` to `apps/api/package.json` beside `seed:traits`.
- Modify: `apps/api/src/routes-visibility.integration.test.ts` / `maps.integration.test.ts` only if needed to keep them green.
- Add a route test (in `maps.integration.test.ts`): an app built with `mapsDir` pointing at a non-existent directory answers `GET /api/maps` 200 `{ data: [] }` and `GET /api/maps/files/x.svg` 404 `MAP_NOT_FOUND`.
- Modify: `infra/docker/api.Dockerfile` — remove `COPY --from=build /workspace/apps/api/maps ./apps/api/maps`.
- Modify: `compose.yml` — `api`: add `MAPS_DIR: /maps` to its `environment` (the `api` service uses the shared `*api-env` anchor; add it without affecting `migrate`, e.g. `environment: { <<: *api-env, MAPS_DIR: /maps }`) and `volumes: ["${MAPS_HOST_DIR:-./apps/api/maps}:/maps:ro"]`, with a one-line comment (private maps, RFC-76 R1). `compose.prod.yml` — `api.volumes: ["/srv/maps:/maps:ro"]` (compose merges by target path) with a comment pointing at `docs/gotchas/infra.md`. Check `compose.e2e.yml` needs nothing (the CI checkout's `apps/api/maps` holds only the header manifest → "No maps yet.", which the e2e spec asserts).
- Modify: `.gitignore` — `apps/api/maps/*.svg` and `apps/api/maps/*.webp` with a comment (private maps, RFC-76 R1).
- Modify: `apps/api/maps/README.md` — rewrite: the directory holds only this README and the header-only manifest in git; on the dev stack you may drop maps here to try the page (git ignores them); production maps live in `/srv/maps` on the server; publishing = copy the R pipeline's `Maps/Platform/` there (`rsync -av --delete Maps/Platform/ <server>:/srv/maps/`), then run `docker compose run --rm --no-deps api node dist/cli/check-maps.js`; no restart needed. Keep the file-format rules already there.
- Modify: `docs/gotchas/infra.md` — a short "Trait maps (private)" section: `/srv/maps` created by hand (`sudo mkdir -p /srv/maps`, readable by the container user), not in the backup (the owner regenerates the maps), publish procedure as above.
- Modify: `CLAUDE.md` — Commands: one entry for `check:maps` (dev and production forms) and the publish pointer; fix any sentence that says the maps are committed.

**Interfaces:**
- Produces: `AppConfig.mapsDir`; `checkMaps(db, dir)`; CLI `check:maps`. Task 2 touches none of these.

- [ ] Step 1: failing tests (manifest missing-dir tests, `check.integration.test.ts`, the route test with a missing directory). Run them: FAIL.
- [ ] Step 2: implement. Run the scoped tests, both route meta-tests, then the whole API suite once: PASS. `pnpm lint && pnpm typecheck && pnpm rfc:check`. `docker compose -f compose.yml -f compose.prod.yml config` (with dummy env, e.g. `DOMAIN=x SMTP_HOST=x SMTP_PORT=1 SMTP_SECURE=false SMTP_USER=x SMTP_FROM=x@x`) shows `api` with `MAPS_DIR=/maps` and the `/srv/maps:/maps:ro` bind, and `migrate` without them — run it in the container or on the host if the Docker CLI is there (it is).
- [ ] Step 3: commit — `feat(api): private maps directory and check:maps (RFC-76 R1, R2)`; docs may be a separate `docs:` commit.

---

### Task 2: Maps explorer

**Files:**
- Rewrite: `apps/web/src/pages/maps/MapsPage.tsx` + `MapsPage.test.tsx`
- Modify: `apps/web/src/routes/app/maps/index.tsx` — `validateSearch` with the existing helpers in `apps/web/src/lib/search-params.ts` (`textParam`): `{ category?: string; trait?: string }` (keys, max 100 chars); navigation with `replace: true` like `routes/app/traits/$id.tsx`
- Delete: `apps/web/src/routes/app/maps/$traitId.tsx`, `apps/web/src/pages/maps/TraitMapsPage.tsx`, `TraitMapsPage.test.tsx` (move any section component worth keeping into the new page or `components/maps/`); regenerate `apps/web/src/routeTree.gen.ts` (docker cp back)
- Modify: the R8 links to `/app/maps?trait=<key>` — `apps/web/src/pages/dataset/TraitPage.tsx` ("See all maps for this trait →"), `apps/web/src/pages/dataset/TraitsPage.tsx` (map icon link), `apps/web/src/components/dataset/TraitCard.tsx`, `EmptyTraitCard.tsx` (HelpTip `extraLink`) + their tests. Use typed TanStack `Link` with `to="/app/maps"` and `search={{ trait: key }}` where the component renders a `Link`; `HelpTip.extraLink` takes a string `to` today — extend it minimally (e.g. an optional `search`) or build the href, whichever keeps typing honest.
- Check: `apps/e2e/tests/maps.spec.ts` still passes unchanged (it asserts the sidebar link, `/app/maps` and "No maps yet.").
- Modify: `CLAUDE.md` — the Layout sentence about the Maps pages (one category at a time, trait buttons, `?category=&trait=`; `/app/maps/$traitId` gone).

**Interfaces:**
- Consumes (existing): `useMaps`, `useHasMaps`, `mapsByTrait`, `mapFileUrl`, `mapAlt`, `MAP_KIND_LABELS` (`apps/web/src/api/maps.ts`), `MapFigure` (`apps/web/src/components/maps/MapFigure.tsx`), `fetchDictionary`/`datasetKeys` (`apps/web/src/api/dataset.ts`), `humaniseKey`, `Badge`, `useBreadcrumb`. In tests, mock `useMaps` itself (see the comment atop the current `MapsPage.test.tsx`).

**Page (RFC-76 R6, R7)** — read the spec rules; the layout:
- Heading "Maps", one intro line ("Global maps per trait, by TDWG level 3 region. Choose a category, then a trait.").
- Category bar: `role="tablist"` (`aria-label="Trait categories"`) of the categories with maps in dictionary order, each a `role="tab"` link/button (`aria-selected`), horizontally scrollable at phone width, selected one visually distinct; selecting sets `?category=<key>` and clears `trait`.
- Category panel (`role="tabpanel"`): `<h2>` category label; trait buttons (`aria-label="Traits in <category>"`, `aria-pressed` on the selected), wrapping; selecting sets `?trait=<key>` (keeps `category`).
- Selected trait block: `<h3>` trait name + Categorical/Quantitative `Badge` + **Trait details** link to `/app/traits/$id`.
  - `<h4>` "Data completeness", legend paragraph exactly "Share of tree species with data for this trait in each TDWG level-3 region.", the map (`MapFigure`, caption `TDWG level 3 regions · <dataVersion>`). Section absent when no completeness map.
  - Quantitative: `<h4>` "Summary statistics"; grid `sm:grid-cols-2`; each map under an `<h5>` "Mean" / "Min" / "Max" / "SD" and a one-line explanation: "Mean of the species means in the region." / "Lowest species mean in the region." / "Highest species mean in the region." / "Standard deviation of the species means in the region."; order Mean, Min, Max, SD; missing kinds omitted.
  - Categorical: `<h4>` "Prevalence by level", legend exactly "Share of the region's tree species with data for this trait that hold each level; a species with several levels counts under each."; grid `sm:grid-cols-2 xl:grid-cols-3`; one `<h5>` per level (level name via `humaniseKey`) in dictionary `sortOrder`, levels without a map omitted.
- Selection rules: `trait` alone selects its category; unknown/mapless `category` or `trait` falls back to the first category / first trait with maps in it; no maps at all → "No maps yet." (existing `EmptyState` pattern). Loading/error states as today (keep the 403 test).
- Breadcrumb `Data › Maps` (`useBreadcrumb([{ label: 'Maps' }])`).
- Keyboard (R7): tabs follow the WAI-ARIA tabs pattern (roving tabIndex, Left/Right wrap, Home/End); trait buttons move with the arrow keys; the full-size dialog becomes one page-level viewer where Left/Right step through the selected trait's maps in page order (wrapping) and show which map it is.
- Match the existing workspace look (tokens, spacing, `TraitsPage`/`SpeciesSearchPage` headings and chip/filter styles if any exist — reuse a chip style already in the codebase rather than inventing one); works at phone width without horizontal page scroll.

- [ ] Step 1: failing tests in `MapsPage.test.tsx`: (a) tabs list only categories with maps in dictionary order, first selected by default; (b) default trait = first trait with maps of the selected category, its buttons in dictionary order with `aria-pressed`; (c) completeness heading + exact legend + caption, then for a quantitative trait the four headings in order with explanations and missing kinds omitted; (d) categorical: "Prevalence by level", exact legend, levels in `sortOrder`, missing levels omitted; (e) `?trait=<key of a trait in the 2nd category>` selects that category and trait; (f) `?category=nope&trait=nope` falls back to defaults; (g) clicking a tab / a trait button updates the URL search; (h) Trait details link; (i) "No maps yet." with no maps; (j) the 403 error test kept. Update TraitPage/TraitsPage/TraitCard/EmptyTraitCard tests to expect `/app/maps?trait=<key>`. Run: FAIL.
- [ ] Step 2: implement; run scoped tests, then the whole web suite once, `pnpm lint && pnpm typecheck && pnpm rfc:check`; docker cp `routeTree.gen.ts` back.
- [ ] Step 3: commit — `feat(web): Maps explorer by category and trait (RFC-76 R6-R8)`.

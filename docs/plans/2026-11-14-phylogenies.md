# Phylogenies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Data › Phylogenies page and a phylogeny beside the map on the trait page. Both show the owner's PNG figures, served privately per platform and viewable in a zoomable full-screen viewer.

**Architecture:** The owner's PNGs live in a private, read-only directory (`PHYLOGENIES_DIR`, `/srv/phylogenies` in production) with one subdirectory per platform. The API lists the figures the request's platform has and streams one file, looked up by trait key and never used as a path. The SPA mirrors the Maps page and adds a CSS-transform zoom viewer. Publishing is a Mac script that makes display copies with `sips`, stages them on the server with `rsync`, runs a `check:phylogenies` CLI against the production database and swaps the staged files in.

**Tech Stack:** Hono 4, Zod 4 (`packages/contracts`), Drizzle + Postgres, React 19 + TanStack Router/Query, Tailwind 4, Vitest + testcontainers, Docker Compose.

**Spec:** `docs/specs/2026-11-14-phylogenies.md`

## Global Constraints

- File names: `trait_<key>.png`, where `<key>` = `traits.key`; coverage `trait_coverage.png`. Display copy `display/trait_<key>.jpg` (JPEG q80, longest side 1600 px, made with macOS `sips -s format jpeg -s formatOptions 80 -Z 1600`).
- Layout: `<PHYLOGENIES_DIR>/<platform>/trait_*.png` and `<PHYLOGENIES_DIR>/<platform>/display/trait_*.jpg`. A missing directory means no figures.
- Never in the repo: `apps/api/phylogenies/*` is gitignored except `README.md`.
- No new runtime dependency (no image or zoom library).
- Routes are `dataset.read` and take `Visibility` (RFC-33 R10). The plot restriction does **not** filter them (owner, 2026-11-14). Inactive traits' figures show only with `dataset.read_inactive`.
- Copy: the empty state reads exactly `Phylogenies are not available on ${name} yet.` (`name` from `platformCopy()`). The first tab is `All traits`. The trait page link reads `See on Phylogenies →`. The popover link reads `Phylogeny`. The section is titled `Maps and phylogeny` when it holds both, `Maps` with only maps and `Phylogeny` with only a figure.
- Rule 10: route catalog, `docs/api/guide.md` and its changelog in the same PR as the routes. Rule 11: both platforms.
- RFC first: `docs/rfc/70-workspace/79-phylogenies.md`. Every export carries `@rfc RFC-79 Rn`.

## Review Focus

1. **Path traversal on the file route** (`../`, `%2F`, an absolute path as `:key`): expect 400 or 404, never a file outside the platform directory. Test in Task 1.
2. **A PNG present for an inactive trait**, requested by a viewer without `dataset.read_inactive`: expect it absent from the list and a 404 on the file. Test in Task 1.
3. **A PNG present on disk with no display copy** (a half-finished publish): the list omits it, so the page never shows a broken image. Test in Task 1. The check in Task 2 refuses it.
4. **A PlantRepro request when only `treerepro/` exists**: an empty list, never TreeRepro's figures. Test in Task 1.
5. **The full PNG failing to load in the viewer:** the display copy stays visible, with no blank dialog. Test in Task 3.

---

### Task 1: RFC-79, API list and file routes, configuration

**Files:**
- Create: `docs/rfc/70-workspace/79-phylogenies.md`
- Create: `apps/api/src/phylogenies/figures.ts`, `apps/api/src/phylogenies/figures.integration.test.ts`
- Create: `apps/api/src/http/routes/dataset/phylogenies.ts`, `apps/api/src/http/routes/dataset/phylogenies.integration.test.ts`
- Create: `apps/api/phylogenies/README.md`
- Create: `packages/contracts/src/phylogenies.ts` (and export it from the contracts index)
- Modify: `apps/api/src/config.ts` (`PHYLOGENIES_DIR`, `AppConfig.phylogeniesDir`, revive the pattern of `MAPS_DIR` from `git show 307738a3^:apps/api/src/config.ts`)
- Modify: `apps/api/src/auth/context.ts` (`phylogeniesDir: string` on `AuthContext`) and the server wiring that builds it
- Modify: `apps/api/src/http/routes/dataset/index.ts` (`.route('/phylogenies', phylogenyRoutes(ctx))`)
- Modify: `apps/api/src/http/route-catalog.ts`, `docs/api/guide.md` (section and changelog entry ending `(openapi <hash12>)`)
- Modify: `compose.yml` (`api`: `environment: { <<: *api-env, PHYLOGENIES_DIR: /phylogenies }`, `volumes: ["${PHYLOGENIES_HOST_DIR:-./apps/api/phylogenies}:/phylogenies:ro"]`), `compose.prod.yml` (`api.volumes: ["/srv/phylogenies:/phylogenies:ro"]`), `.gitignore`
- Modify: `docs/rfc/70-workspace/76-trait-maps.md` (R7, R8 cross-reference RFC-79; changelog line)

**Interfaces:**
- Produces (contracts):
  - `phylogenyFigureSchema = z.object({ key: z.string(), traitId: z.uuid().nullable(), version: z.string() })`, with type `PhylogenyFigure`. `key` is the trait key or `'coverage'`, `traitId` is null for coverage, and `version` is the full PNG's mtime in ms, as a string.
  - `phylogenyFileParamSchema = z.object({ key: z.string().regex(/^[a-z0-9_]+$/) })`
  - `phylogenyFileQuerySchema = z.object({ size: z.enum(['display', 'full']), v: z.string().optional() })`
- Produces (API):
  - `listFigures(db: Db, visibility: Visibility, dir: string): Promise<PhylogenyFigure[]>` in `figures.ts`. It reads `<dir>/<visibility.platform>/`, keeps `trait_<key>.png` files that have `display/trait_<key>.jpg`, and includes `coverage` plus each key that is a trait visible to the viewer (reuse the trait-visibility helper `listMaps` uses). Order: coverage first, then trait key.
  - `figurePath(dir: string, platform: Platform, key: string, size: 'display' | 'full'): string`
  - Routes: `GET /api/phylogenies` → `{ data: PhylogenyFigure[] }`; `GET /api/phylogenies/files/:key?size=&v=` → image bytes. The file route answers `Content-Type` `image/png` or `image/jpeg` and `Cache-Control: private, max-age=31536000, immutable` (the URL carries `v`). An unknown or invisible key answers 404 `PHYLOGENY_NOT_FOUND`. The key is looked up in `listFigures`'s answer and never joined into a path otherwise.

- [ ] **Step 1: Write RFC-79.**
  - **R1** Files and layout: the Global Constraints, verbatim.
  - **R2** List route.
  - **R3** File route.
  - **R4** Visibility: inactive traits are gated; the plot restriction does not apply (owner, 2026-11-14), as for maps (RFC-76 R5).
  - **R5** The `check:phylogenies` command and its refusals.
  - **R6** The Phylogenies page, the viewer and the empty state.
  - **R7** The trait page section and the popover link.
  - **R8** Publishing procedure.

  Add the RFC-76 cross-references.
- [ ] **Step 2: Write the failing tests** in `figures.integration.test.ts`, using a temp dir and the testcontainers database:
  - `lists coverage first, then visible traits by key, each with its mtime as version`.
  - `omits a PNG without its display copy`.
  - `omits a file whose key is not a trait, other than coverage`.
  - `omits an inactive trait's figure unless the viewer holds dataset.read_inactive`.
  - `reads only the request platform's directory: plantrepro with only treerepro/ is []`.
  - `a missing directory is []`.
- [ ] **Step 3: Write the failing route tests** in `phylogenies.integration.test.ts`:
  - `GET /api/phylogenies needs dataset.read` (401 and 403).
  - `a plot-restricted viewer sees every figure`.
  - `GET /files/:key?size=display answers image/jpeg with immutable private cache`.
  - `size=full answers image/png`.
  - `unknown key → 404 PHYLOGENY_NOT_FOUND`.
  - `inactive trait key → 404 for a viewer without dataset.read_inactive`.
  - `'..%2F..%2Fetc%2Fpasswd' and 'a/b' → 400 VALIDATION_FAILED or 404, never 200`.
  - `size=other → 400`.
- [ ] **Step 4: Run them.** Run `pnpm --filter @treerepro/api exec vitest run src/phylogenies src/http/routes/dataset/phylogenies` in the verify container. Expected: FAIL (module not found).
- [ ] **Step 5: Implement.** Write the contracts, config, `figures.ts`, routes, wiring, compose, `.gitignore`, the README (layout and "never commit figures"), the route catalog and the guide.
- [ ] **Step 6: Run the checks.** Run the scoped tests, both route meta-tests (RFC-32, RFC-33 R10), the whole API suite once, then `pnpm lint && pnpm typecheck && pnpm rfc:check`. Expected: all pass. The guide hash test passes once the changelog entry ends with the new hash.
- [ ] **Step 7: Commit.** Message: `feat(phylogenies): private figures per platform, list and file routes (RFC-79)`.

### Task 2: `check:phylogenies` and the publish script

**Files:**
- Create: `apps/api/src/phylogenies/check.ts`, `apps/api/src/phylogenies/check.integration.test.ts`, `apps/api/src/cli/check-phylogenies.ts`
- Modify: `apps/api/package.json` (`"check:phylogenies": "node --conditions=development src/cli/check-phylogenies.ts"`)
- Create: `scripts/phylogenies/publish.sh`
- Modify: `docs/gotchas/infra.md` (section "Phylogeny figures (private)"), `CLAUDE.md` (Layout: `/app/phylogenies`; Commands: `check:phylogenies` and `scripts/phylogenies/publish.sh`)

**Interfaces:**
- Consumes: the file layout from Task 1.
- Produces: `checkFigures(db: Db, dir: string): Promise<{ ok: boolean; unknown: string[]; missingDisplay: string[]; withoutFigure: string[]; coverageClash: boolean }>`.
  - `dir` is one platform directory.
  - `unknown`: PNG keys that are neither a trait nor `coverage`.
  - `missingDisplay`: PNGs without a display copy.
  - `withoutFigure`: active traits that have no figure (a report only, never a failure).
  - `coverageClash`: a trait whose key is `coverage`.
  - `ok` is false on any unknown, missing display copy or clash.
  - The CLI is `--dir <path>`. It prints the report and exits 1 when not `ok`.

- [ ] **Step 1: Write the failing tests:**
  - `ok for matching names with display copies, listing traits without a figure`.
  - `refuses an unknown name`.
  - `refuses a PNG without display copy`.
  - `refuses when a trait is keyed coverage`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `checkFigures` and the CLI.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Write `scripts/phylogenies/publish.sh <source-dir> <platform>`** (POSIX sh, `set -eu`):
  1. In a temp copy, make `display/` with `sips` for each `trait_*.png`.
  2. `rsync -a --delete` the result to `root@<host>:/srv/phylogenies-staging/<platform>/`. The host comes from `$TREEREPRO_HOST`; the agent socket is the caller's.
  3. On the server, run `docker compose run --rm --no-deps -v /srv/phylogenies-staging:/staging:ro api node dist/cli/check-phylogenies.js --dir /staging/<platform>`.
  4. Only on success, `rsync -a --delete` staging into `/srv/phylogenies/<platform>/` and fix the permissions (`chmod -R a+rX`; files in a OneDrive folder arrive as 700).

  Document the procedure in `docs/gotchas/infra.md`.
- [ ] **Step 6: Run** `pnpm lint && pnpm typecheck && pnpm rfc:check`, and `sh -n scripts/phylogenies/publish.sh`. Expected: all pass.
- [ ] **Step 7: Commit.** Message: `feat(phylogenies): check:phylogenies and the publish script (RFC-79 R5, R8)`.

### Task 3: The Phylogenies page and the zoom viewer

**Files:**
- Create: `apps/web/src/api/phylogenies.ts`
- Create: `apps/web/src/components/phylogenies/PhylogenyViewer.tsx` and `PhylogenyViewer.test.tsx`
- Create: `apps/web/src/pages/phylogenies/PhylogeniesPage.tsx` and `PhylogeniesPage.test.tsx`
- Create: `apps/web/src/routes/app/phylogenies/index.tsx` (search params `category?: string`, `trait?: string`; follow `routes/app/maps/index.tsx`). `routeTree.gen.ts` is regenerated by the build.
- Modify: `apps/web/src/components/shell/nav.ts` (after Maps: `{ to: '/app/phylogenies', label: 'Phylogenies', icon: <an existing IconName, or add one tree-like path to Icon.tsx>, permission: 'dataset.read', section: 'data' }`), `AppShell.test.tsx`
- Grep: every file in `apps/e2e` that asserts the sidebar's Data entries.

**Interfaces:**
- Consumes: `GET /api/phylogenies`, `GET /api/phylogenies/files/:key`.
- Produces:
  - `fetchPhylogenies(): Promise<PhylogenyFigure[]>`
  - `usePhylogenies()`, a TanStack query with key `['phylogenies']` and `staleTime: Infinity`
  - `figureUrl(f: PhylogenyFigure, size: 'display' | 'full'): string`, which returns `/api/phylogenies/files/${key}?size=${size}&v=${version}`
  - `phylogenyByTrait(figures): Map<string, PhylogenyFigure>`, keyed by traitId
  - `PhylogenyViewer({ items: { figure: PhylogenyFigure; heading: string }[]; index: number | null; onIndexChange(i: number): void; onClose(): void })`

- [ ] **Step 1: Write the failing viewer tests:**
  - `opens on the display copy and swaps to the full PNG on load`.
  - `+ and − zoom (1× to 4×, ×1.5 per step) and 0 resets`.
  - `wheel zooms, drag pans while zoomed`.
  - `ArrowLeft/ArrowRight move between items, wrapping, and reset zoom`.
  - `Escape closes`.
  - `keeps the display copy when the full PNG fails to load` (Review Focus 5).

  Build the viewer like `MapViewer`: a native `<dialog>` with `showModal`, `transform: translate() scale()` on the `<img>`, and pointer events for the drag.
- [ ] **Step 2: Write the failing page tests:**
  - `defaults to All traits and shows the coverage figure`.
  - `category tabs follow All traits, in dictionary order, only categories with figures`.
  - `?trait=<key> selects its category and shows that figure, headed by the trait name`.
  - `an unknown trait key falls back to All traits`.
  - `with no figures, shows "Phylogenies are not available on TreeRepro yet."`; the same with the platform mocked to plantrepro, which reads PlantRepro.
  - `clicking the figure opens the viewer on it`.
  - `the sidebar lists Phylogenies after Maps`.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement** the client, the viewer, the page (reuse `MapsPage`'s tab and button markup and its arrow-key handling; copy the pattern, and extract a shared component only if the copy exceeds ~40 lines), the route and the nav entry.
- [ ] **Step 5: Run the checks.** Run the web suite (`--maxWorkers=3 --testTimeout=30000`), then `pnpm lint && pnpm typecheck && pnpm rfc:check`. Expected: all pass.
- [ ] **Step 6: Commit.** Message: `feat(phylogenies): Data › Phylogenies page and zoom viewer (RFC-79 R6)`.

### Task 4: Trait page section and popover link

**Files:**
- Modify: `apps/web/src/pages/dataset/TraitPage.tsx` (`TraitMaps` becomes the combined section) and its test
- Modify: `apps/web/src/components/dataset/TraitCard.tsx:232`, `apps/web/src/components/dataset/EmptyTraitCard.tsx:50` (add the `Phylogeny` link `{ to: '/app/phylogenies', search: { trait: trait.key }, label: 'Phylogeny' }` when the trait has a figure) and their tests

**Interfaces:**
- Consumes: `usePhylogenies`, `phylogenyByTrait`, `figureUrl`, `PhylogenyViewer` (Task 3); `useMaps`, `mapsByTrait` (existing).

- [ ] **Step 1: Write the failing tests** on the trait page:
  - `with maps and a figure: section "Maps and phylogeny", the map and the phylogeny side by side (stacked below 768 px), and "See on Phylogenies →" linking /app/phylogenies?trait=<key>`.
  - `with only a figure: section "Phylogeny"`.
  - `with only maps on a platform that has figures: section "Maps", no note`.
  - `with maps on a platform with no figures: the note beside the map`.
  - `with neither: no section`.
  - `clicking the phylogeny opens the viewer`.

  On the cards: `the help popover offers Phylogeny when the trait has a figure`, and `no Phylogeny link otherwise`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The note shows only when `usePhylogenies` resolved to `[]` (the platform has none) and the trait has maps.
- [ ] **Step 4: Run the checks.** Run the web suite, `pnpm lint && pnpm typecheck && pnpm rfc:check`, and grep `apps/e2e` for `'Maps'` section assertions on the trait page. Expected: all pass.
- [ ] **Step 5: Commit.** Message: `feat(phylogenies): the trait page shows the phylogeny beside the map (RFC-79 R7)`.

### Task 5: Ship

- [ ] **Step 1: Rebase and check.** Rebase on `origin/main`, then run typecheck and the whole suite once in a fresh verify container.
- [ ] **Step 2: Review and open the PR.** Run CodeRabbit locally (`--base-commit $(git merge-base HEAD origin/main)`), fix the valid findings, push and open the PR (`Closes #<issue>`). Merge when green.
- [ ] **Step 3: Prepare the server.** In production, before the first publish: `mkdir -p /srv/phylogenies/treerepro /srv/phylogenies/plantrepro /srv/phylogenies-staging`. The `compose.prod.yml` bind needs the directory to exist before the deploy recreates `api`, so do this **before merging**.
- [ ] **Step 4: First publish.** When the owner hands over the regenerated figures, run `scripts/phylogenies/publish.sh <dir> treerepro`, then check `GET /api/phylogenies` through the site.
- [ ] **Step 5: Close the issue.** Add its Outcome section and remove the `in-progress` label.

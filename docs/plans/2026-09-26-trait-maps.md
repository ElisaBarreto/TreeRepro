# Trait Maps (issue #197) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Maps area that displays precomputed, committed map images per trait (completeness, level prevalence, quantitative summaries), linked both ways with the trait dictionary.

**Architecture:** Image files and a `manifest.csv` live in `apps/api/maps/` and ship in the API image. The API parses the manifest, joins it with the dictionary under the viewer's `Visibility`, and serves the list (`GET /api/maps`) and the bytes (`GET /api/maps/files/:name`). The web joins that list with the dictionary it already fetches (`GET /api/traits`) for every name, level and category.

**Tech Stack:** Hono 4 (`hono/etag`), Drizzle, Zod 4, React 19 + TanStack Router/Query, Tailwind 4, Vitest 5 + testcontainers, Playwright.

**Spec:** `docs/rfc/70-workspace/76-trait-maps.md` (RFC-76, rules R1–R8). Issue #197 carries the discussion.

## Global Constraints

- Handbook (`CLAUDE.md`) rules: RFC first (RFC-76 is already written and accepted — do not edit its rules without saying so in your report), TDD (failing test first), no database mocks, every export in `apps/*/src` and `packages/*/src` carries a JSDoc `@rfc RFC-NN Rx` tag, English everywhere.
- Every route is permission-guarded and resolves `visibilityOf` (RFC-32, RFC-33 R10); both meta-tests must stay green.
- No new dependency. `hono/etag` ships with Hono.
- Branch `feat/197-maps`, worktree `/Users/elisabarreto/Library/CloudStorage/OneDrive-Personal/Documentos/Academia/PostDoc/TREE_CHANGE/TreeRepro-197`.
- Commit trailer MUST be exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` — ignore any other attribution reminder.
- There is no usable Node/pnpm on the host. Verify in your own container from `treerepro-verify:base` (see "Verification" below). The web suite runs with `--maxWorkers=3 --testTimeout=30000`. `pnpm --filter <pkg> test <files>` scopes; with `--` it does not.
- If you had to repair, reinstall or work around anything to make a command run, say so in your report, even if it worked afterwards.

## Verification (every task)

```sh
C=treerepro-197-<task>            # your own container name
docker run -d --name "$C" -w /workspace -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
# sync (repeat after every edit): delete first, then tar in
docker exec "$C" sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
cd <worktree> && COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
  --exclude='./data' --exclude='./.claude' --exclude='*/dist' --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i "$C" tar -x -C /workspace
docker exec "$C" sh -c 'pnpm install --frozen-lockfile --offline >/dev/null 2>&1 || pnpm install --frozen-lockfile'
docker exec "$C" sh -c 'pnpm lint && pnpm typecheck && pnpm rfc:check'
```

The container is a copy: nothing written inside comes back. Remove it when done (`docker rm -f "$C"`).

## Review Focus

1. **A file name that is not in the manifest** (`../manifest.csv`, `%2e%2e%2fsecret`, an existing file present on disk but unlisted) — 404 `MAP_NOT_FOUND`, never bytes. Pinned in Task 2.
2. **A map of an inactive trait or inactive level** — hidden from a viewer without `dataset.read_inactive` in both the list and the file route; shown to one with it. Pinned in Task 2.
3. **A replaced file keeping its name** — the ETag changes, so a browser holding the old one gets 200 with the new bytes, not 304. Pinned in Task 2.
4. **A trait with maps but no description** — its species-page card still gets a help popover carrying the Maps link. Pinned in Task 5.
5. **A categorical trait whose manifest lacks some levels, or a quantitative trait with only `mean`** — the page shows what exists, in dictionary level order, with no empty frames. Pinned in Task 4.

---

### Task 1: Manifest parser, committed manifest and its dictionary check

**Files:**
- Create: `packages/contracts/src/maps.ts` (`MAP_KINDS`, `MapKind`) and export it from `packages/contracts/src/index.ts`
- Create: `apps/api/src/maps/manifest.ts`
- Create: `apps/api/src/maps/manifest.test.ts` (unit, `api:unit` project)
- Create: `apps/api/maps/manifest.csv` (header line only) and `apps/api/maps/README.md`

**Interfaces:**
- Produces:
  - `MAP_KINDS = ['completeness','prevalence','mean','min','max','sd'] as const`, `type MapKind` (contracts).
  - `interface ManifestRow { line: number; traitKey: string; kind: MapKind; levelKey: string | null; file: string; dataVersion: string }`
  - `parseManifest(text: string, filesPresent: ReadonlySet<string>): ManifestRow[]` — pure; throws `Error('maps manifest line <n>: <reason>')` on any R1 breach.
  - `readManifest(dir: string): Promise<ManifestRow[]>` — reads `<dir>/manifest.csv` and the directory listing, calls `parseManifest`.
  - `defaultMapsDir(): string` — `fileURLToPath(new URL('../../maps', import.meta.url))` (works from `src/` and `dist/`, same idiom as `dictionaryPath()` in `apps/api/src/dataset/seed.ts`).
  - `KIND_FITS: Record<MapKind, TraitValueType | 'any'>` — `completeness: 'any'`, `prevalence: 'categorical'`, the four others `'quantitative'`. Task 2 reuses it.

- [ ] **Step 1: Write the failing tests** — `apps/api/src/maps/manifest.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest.ts';

const HEADER = 'trait_key,map_kind,level_key,file,data_version';
const files = new Set(['a.svg', 'b.webp', 'c.svg']);
const parse = (...rows: string[]) => parseManifest([HEADER, ...rows].join('\n'), files);

describe('parseManifest (RFC-76 R1)', () => {
  it('parses rows, empty level as null, in file order', () => {
    expect(parse('seed_mass,mean,,b.webp,2026-09-01', 'flower_color,prevalence,red,a.svg,2026-08-31')).toEqual([
      { line: 2, traitKey: 'seed_mass', kind: 'mean', levelKey: null, file: 'b.webp', dataVersion: '2026-09-01' },
      { line: 3, traitKey: 'flower_color', kind: 'prevalence', levelKey: 'red', file: 'a.svg', dataVersion: '2026-08-31' },
    ]);
  });
  it('accepts a header-only manifest and a trailing newline / CRLF', () => {
    expect(parseManifest(`${HEADER}\n`, files)).toEqual([]);
    expect(parseManifest(`${HEADER}\r\nx,completeness,,a.svg,2026-09-01\r\n`, files)).toHaveLength(1);
  });
  it.each([
    ['a wrong header', 'trait,map_kind,level_key,file,data_version', /line 1/],
    ['an unknown kind', `${HEADER}\nx,median,,a.svg,2026-09-01`, /line 2.*map_kind/],
    ['prevalence without level', `${HEADER}\nx,prevalence,,a.svg,2026-09-01`, /line 2.*level_key/],
    ['a level on another kind', `${HEADER}\nx,mean,red,a.svg,2026-09-01`, /line 2.*level_key/],
    ['a path in file', `${HEADER}\nx,mean,,../a.svg,2026-09-01`, /line 2.*file/],
    ['an unsupported extension', `${HEADER}\nx,mean,,a.png,2026-09-01`, /line 2.*file/],
    ['an uppercase file name', `${HEADER}\nx,mean,,A.svg,2026-09-01`, /line 2.*file/],
    ['a missing file', `${HEADER}\nx,mean,,zzz.svg,2026-09-01`, /line 2.*not found/],
    ['an impossible date', `${HEADER}\nx,mean,,a.svg,2026-02-30`, /line 2.*data_version/],
    ['a repeated file', `${HEADER}\nx,mean,,a.svg,2026-09-01\ny,mean,,a.svg,2026-09-01`, /line 3.*file/],
    ['a repeated map', `${HEADER}\nx,mean,,a.svg,2026-09-01\nx,mean,,c.svg,2026-09-01`, /line 3.*duplicate/],
    ['a wrong column count', `${HEADER}\nx,mean,a.svg,2026-09-01`, /line 2/],
    ['an empty trait key', `${HEADER}\n,mean,,a.svg,2026-09-01`, /line 2.*trait_key/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseManifest(text, files)).toThrow(message);
  });
});
```

Add in the same file the R2 check against the committed files (reads real files, no database):

```ts
import { readFile, readdir } from 'node:fs/promises';
import { dictionaryPath } from '../dataset/seed.ts';
import { parseCsvLine } from '../dataset/import.ts';
import { defaultMapsDir, KIND_FITS, readManifest } from './manifest.ts';

describe('the committed manifest agrees with the dictionary (RFC-76 R2)', () => {
  it('names dictionary traits, fitting kinds and existing levels', async () => {
    const rows = await readManifest(defaultMapsDir());
    const [, ...lines] = (await readFile(dictionaryPath(), 'utf8')).trim().split(/\r?\n/);
    // header: final_standard_trait,broad_category,trait_value_type,standard_unit,description,harmonised_levels[,active]
    const dict = new Map(lines.map((l) => {
      const f = parseCsvLine(l);
      return [f[0], { valueType: f[2], levels: new Set((f[5] ?? '').split(';').filter(Boolean)) }];
    }));
    for (const row of rows) {
      const trait = dict.get(row.traitKey);
      expect(trait, `line ${row.line}: unknown trait ${row.traitKey}`).toBeDefined();
      const fits = KIND_FITS[row.kind];
      if (fits !== 'any') expect(trait?.valueType, `line ${row.line}: ${row.kind} on ${trait?.valueType}`).toBe(fits);
      if (row.levelKey) expect(trait?.levels.has(row.levelKey), `line ${row.line}: unknown level ${row.levelKey}`).toBe(true);
    }
  });
  it('lists every image in the directory (no orphan files)', async () => {
    const listed = new Set((await readManifest(defaultMapsDir())).map((r) => r.file));
    const images = (await readdir(defaultMapsDir())).filter((f) => /\.(svg|webp)$/i.test(f));
    expect(images.filter((f) => !listed.has(f))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

`docker exec "$C" pnpm --filter @treerepro/api test src/maps/manifest.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/contracts/src/maps.ts`:

```ts
/**
 * The kinds of map a manifest row may name (RFC-76 R1).
 * @rfc RFC-76 R1
 */
export const MAP_KINDS = ['completeness', 'prevalence', 'mean', 'min', 'max', 'sd'] as const;
/** @rfc RFC-76 R1 */
export type MapKind = (typeof MAP_KINDS)[number];
```

`apps/api/src/maps/manifest.ts` — use `parseCsvLine` from `../dataset/import.ts` (do not write a CSV parser). Rules in order per line: column count 5; `trait_key` non-empty; `map_kind` in `MAP_KINDS`; `level_key` non-empty iff `prevalence`; `file` matches `/^[a-z0-9][a-z0-9._-]*\.(svg|webp)$/` (case-sensitive) and is in `filesPresent` (message contains `not found`); `data_version` matches `/^\d{4}-\d{2}-\d{2}$/` and round-trips through `new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10)`; file not seen before (message contains `file`); `(traitKey, kind, levelKey ?? '')` not seen before (message contains `duplicate`). Blank lines (after trimming `\r`) are skipped. `readManifest(dir)` = `parseManifest(await readFile(join(dir,'manifest.csv'),'utf8'), new Set(await readdir(dir)))`. Tag every export `@rfc RFC-76 R1` (`KIND_FITS`: `@rfc RFC-76 R2`).

`apps/api/maps/manifest.csv`: exactly `trait_key,map_kind,level_key,file,data_version` plus newline.

`apps/api/maps/README.md` — the procedure for the map author (Elisa), short:

```md
# Trait maps (RFC-76)

Each map is an image in this directory, listed on one line of `manifest.csv`:

    trait_key,map_kind,level_key,file,data_version
    flower_color,completeness,,flower_color-completeness.svg,2026-10-01
    flower_color,prevalence,red,flower_color-prevalence-red.svg,2026-10-01
    seed_dry_mass,mean,,seed_dry_mass-mean.svg,2026-10-01

- `trait_key` and `level_key` are the keys of `apps/api/seed/trait-dictionary.csv`.
- `map_kind`: `completeness` (any trait), `prevalence` (categorical, one row per level, `level_key` required), `mean`, `min`, `max`, `sd` (quantitative).
- `file`: lowercase letters, digits, `.`, `_`, `-`; ending `.svg` (preferred) or `.webp` (for a map too heavy as SVG, ~2000 px wide).
- `data_version`: the date the map was generated.
- Regions are TDWG level 3; the legend goes inside the image; prevalence maps of one trait share one colour scale.
- SVG: simplified geometry (target ≤ 300 KB), `viewBox` set, text as paths or a common sans font, no embedded raster, no scripts; colour-blind-safe palettes (viridis).
- To replace a map, overwrite the file under the same name and update its `data_version`. Changes go through a pull request; `pnpm test` checks the manifest against the dictionary.
```

- [ ] **Step 4: Run the tests** — same command → PASS. Then `pnpm lint && pnpm typecheck && pnpm rfc:check` in the container.

- [ ] **Step 5: Commit** — `feat(api): trait-map manifest and its dictionary check (RFC-76 R1, R2)` with the trailer.

---

### Task 2: `GET /api/maps` and `GET /api/maps/files/:name`

**Files:**
- Modify: `packages/contracts/src/maps.ts` (add `mapEntrySchema`, `MapEntry`)
- Modify: `packages/contracts/src/error-codes.ts` (add `MAP_NOT_FOUND: 404`; also add it to the RFC-12 catalog table in `docs/rfc/10-platform/12-*.md` if the file keeps one — check, and add a changelog line there)
- Modify: `apps/api/src/app.ts` (`AppDeps` gains `mapsDir?: string`, passed into the context; default `defaultMapsDir()`), `apps/api/src/auth/context.ts` (`AuthContext.mapsDir: string`, tagged `@rfc RFC-76 R1`)
- Create: `apps/api/src/maps/visible.ts` (`visibleMaps`), `apps/api/src/http/routes/dataset/maps.ts` (`mapRoutes`)
- Modify: `apps/api/src/http/routes/dataset/index.ts` (`.route('/maps', mapRoutes(ctx))`)
- Create: `apps/api/src/http/routes/dataset/maps.integration.test.ts`
- Create: `apps/api/test/fixtures/maps/manifest.csv` + `apps/api/test/fixtures/maps/map_fixture-completeness.svg`
- Modify: `apps/api/test/helpers/app.ts` (default `mapsDir` = the fixture directory, via `fileURLToPath(new URL('../fixtures/maps', import.meta.url))`)
- Modify: `apps/api/src/routes-guarded.integration.test.ts` (add both routes to the exact list, in sorted position), `apps/api/src/routes-visibility.integration.test.ts` (fill `:name`, create the fixture's trait)
- Modify: `infra/docker/api.Dockerfile` — add `COPY --from=build /workspace/apps/api/maps ./apps/api/maps` next to the `seed` line

**Interfaces:**
- Consumes: `readManifest`, `KIND_FITS`, `defaultMapsDir`, `ManifestRow` (Task 1); `requirePermission`, `visibilityOf`, `traitVisible`, `levelVisible` (`apps/api/src/access/visibility.ts`); `traits`, `traitLevels` (`apps/api/src/db/schema/dictionary.ts`).
- Produces:
  - contracts: `mapEntrySchema = z.strictObject({ traitId: z.uuid(), kind: z.enum(MAP_KINDS), levelId: z.uuid().nullable(), file: z.string(), dataVersion: z.iso.date() })`, `mapsResponseSchema = z.array(mapEntrySchema)`, `type MapEntry`.
  - `visibleMaps(db: DbExecutor, visibility: Visibility, dir: string): Promise<MapEntry[]>`.
  - HTTP: `GET /api/maps` → `{ data: MapEntry[] }`; `GET /api/maps/files/:name` → image bytes (R5).

- [ ] **Step 1: Write the failing integration tests** — `maps.integration.test.ts`. Each test writes its own manifest in a temp dir (`mkdtemp(join(tmpdir(),'maps-'))`, write `manifest.csv` + tiny files) and builds an app with `t.build({ mapsDir })`. Use `createTrait` (with `valueType`, `levels`, and an inactive trait / inactive level — read `apps/api/test/helpers/dataset.ts` for its options), `createRole`, `createUser`, `loginAs`, `call` as in `traits.integration.test.ts`. Cases:
  1. `GET /api/maps` as a `dataset.read` user returns, in manifest order, the completeness row, the prevalence row (with the level's id) and a quantitative `mean` row; it drops: an unknown trait key, a `mean` row on a categorical trait, a `prevalence` row on a quantitative trait, a prevalence row for a level key the trait lacks. Parse the body with `dataEnvelopeSchema(mapsResponseSchema)`.
  2. Inactive trait and inactive level: absent for `dataset.read` only; present for a role with `dataset.read` + `dataset.read_inactive`; the file route answers 404 `MAP_NOT_FOUND` for the first and 200 for the second.
  3. A plot-restricted user (see `createVisibilityFixture` or how `routes-visibility` builds a restricted user) sees the same list as an unrestricted one (R4: the plot restriction does not filter).
  4. File route: `.svg` → `content-type: image/svg+xml`, `.webp` → `image/webp`, `cache-control: private, no-cache`, body equals the file bytes, `etag` header present; repeating with `If-None-Match: <etag>` → 304; after overwriting the file with new bytes (same name), the old etag → 200 with the new bytes.
  5. File route 404 `MAP_NOT_FOUND` (JSON error body) for: a name absent from the manifest but present on disk (write `unlisted.svg` into the dir), `manifest.csv`, `..%2Fmanifest.csv`, `%2e%2e%2fsecret.svg`.
  6. No session → 401; a user without `dataset.read` → 403 (both routes).

- [ ] **Step 2: Run to see them fail** — `docker exec "$C" pnpm --filter @treerepro/api test src/http/routes/dataset/maps.integration.test.ts` → FAIL (404s).

- [ ] **Step 3: Implement**

`apps/api/src/maps/visible.ts`:

```ts
/**
 * The manifest rows a viewer may see, with dictionary ids: the trait must
 * exist and be visible, the kind must fit its value type, and a prevalence
 * row's level must exist on the trait and be visible. No plot filter.
 * @rfc RFC-76 R4
 */
export async function visibleMaps(db: DbExecutor, visibility: Visibility, dir: string): Promise<MapEntry[]> {
  const rows = await readManifest(dir);
  if (rows.length === 0) return [];
  const keys = [...new Set(rows.map((r) => r.traitKey))];
  const found = await db
    .select({ id: traits.id, key: traits.key, valueType: traits.valueType })
    .from(traits)
    .where(and(inArray(traits.key, keys), traitVisible(visibility)));
  const byKey = new Map(found.map((t) => [t.key, t]));
  const levels = found.length === 0 ? [] : await db
    .select({ id: traitLevels.id, traitId: traitLevels.traitId, key: traitLevels.key })
    .from(traitLevels)
    .where(and(inArray(traitLevels.traitId, found.map((t) => t.id)), levelVisible(visibility)));
  const levelId = new Map(levels.map((l) => [`${l.traitId}\u0000${l.key.toLowerCase()}`, l.id]));
  const out: MapEntry[] = [];
  for (const row of rows) {
    const trait = byKey.get(row.traitKey);
    if (!trait) continue;
    const fits = KIND_FITS[row.kind];
    if (fits !== 'any' && fits !== trait.valueType) continue;
    const lid = row.levelKey === null ? null : levelId.get(`${trait.id}\u0000${row.levelKey.toLowerCase()}`);
    if (lid === undefined) continue;
    out.push({ traitId: trait.id, kind: row.kind, levelId: lid, file: row.file, dataVersion: row.dataVersion });
  }
  return out;
}
```

(Level keys are unique per trait on `lower(key)`, hence the case-folded lookup. Check the actual column names in the schema file before using them.)

`apps/api/src/http/routes/dataset/maps.ts`:

```ts
const CONTENT_TYPES = { svg: 'image/svg+xml', webp: 'image/webp' } as const;

/**
 * The trait maps: the list a viewer may see and the files it names.
 * @rfc RFC-76 R4, R5
 */
export function mapRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .get('/', requirePermission(ctx, 'dataset.read'), async (c) => {
      const visibility = await visibilityOf(ctx, c);
      return c.json({ data: await visibleMaps(ctx.db, visibility, ctx.mapsDir) });
    })
    .get('/files/:name', requirePermission(ctx, 'dataset.read'), etag(), async (c) => {
      const visibility = await visibilityOf(ctx, c);
      const name = c.req.param('name');
      const entry = (await visibleMaps(ctx.db, visibility, ctx.mapsDir)).find((m) => m.file === name);
      if (!entry) throw new AppError('MAP_NOT_FOUND');
      const ext = entry.file.slice(entry.file.lastIndexOf('.') + 1) as keyof typeof CONTENT_TYPES;
      c.header('Content-Type', CONTENT_TYPES[ext]);
      c.header('Cache-Control', 'private, no-cache');
      return c.body(await readFile(join(ctx.mapsDir, entry.file)));
    });
}
```

Match the real `AppError` import/constructor and the existing `validate('param', …)` convention in `traits.ts` (a strict Zod param schema, e.g. `z.strictObject({ name: z.string().max(200) })`, if every route validates its params). `etag()` is from `hono/etag`; confirm it computes a strong hash of the body and answers 304 itself. If the guard meta-test's `markGuard` detection requires `requirePermission` to be the first handler, keep that order.

Fixture: `apps/api/test/fixtures/maps/manifest.csv` =

```
trait_key,map_kind,level_key,file,data_version
map_fixture,completeness,,map_fixture-completeness.svg,2026-09-01
```

and `map_fixture-completeness.svg` = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="2" height="1"/></svg>`.

Meta-tests:
- `routes-guarded`: add `'GET /api/maps'` and `'GET /api/maps/files/:name'` to the exact sorted list. Its negative sweep only replaces `:id`; `:name` stays literal, which still yields 401/403 before the handler — confirm, and that the admin call to the literal `:name` path gives 404 (not 403), which that sweep accepts.
- `routes-visibility`: create a trait with key `map_fixture` (active, `valueType: 'categorical'`, via `createTrait`) before the sweep and add `.replace(':name', 'map_fixture-completeness.svg')` to `concrete()`. Both routes must pass without joining `VISIBILITY_EXEMPT_ROUTES`. If `createTrait` cannot take a fixed key, create the row directly with the Drizzle `traits` table as the helper does.

- [ ] **Step 4: Run** the new test file, then both meta-test files, then the whole `api:integration` project once: `docker exec "$C" pnpm --filter @treerepro/api test` → PASS. Then `pnpm lint && pnpm typecheck && pnpm rfc:check`.

- [ ] **Step 5: Commit** — `feat(api): serve trait maps behind dataset.read (RFC-76 R4, R5)` with the trailer.

---

### Task 3: Web — maps client, shared figure, sidebar entry and `/app/maps`

**Files:**
- Create: `apps/web/src/api/maps.ts`
- Create: `apps/web/src/components/maps/MapFigure.tsx` + `MapFigure.test.tsx`
- Modify: `apps/web/src/components/shell/nav.ts` (entry after Traits; add `@rfc RFC-76 R6` to the `NAV_ENTRIES` doc block)
- Create: `apps/web/src/routes/app/maps/index.tsx`, `apps/web/src/pages/maps/MapsPage.tsx` + `MapsPage.test.tsx`
- Modify: `apps/web/src/routeTree.gen.ts` (regenerated by the Vite plugin during the test/build run inside the container; `docker cp` it back out and commit it)
- Create: `apps/e2e/tests/maps.spec.ts` (read one existing spec in `apps/e2e` first and copy its login/setup helpers)

**Interfaces:**
- Consumes: `mapsResponseSchema`, `MapEntry`, `MapKind` (contracts); `apiFetch` (`apps/web/src/api/client.ts`); `dataEnvelopeSchema`; `fetchDictionary`, `datasetKeys` (`apps/web/src/api/dataset.ts`); `humaniseKey` (`apps/web/src/lib/format.ts`); `Badge`; `useBreadcrumb`.
- Produces (Tasks 4 and 5 use these exact names):
  - `mapsKeys = { all: ['maps'] as const }`
  - `fetchMaps(): Promise<MapEntry[]>` → `apiFetch('/maps', dataEnvelopeSchema(mapsResponseSchema))`
  - `mapFileUrl(file: string): string` → `` `/api/maps/files/${encodeURIComponent(file)}` ``
  - `mapsByTrait(entries: readonly MapEntry[]): Map<string, MapEntry[]>` (keeps order)
  - `useMaps()` → `useQuery({ queryKey: mapsKeys.all, queryFn: fetchMaps })`
  - `MAP_KIND_LABELS: Record<MapKind, string>` = `{ completeness: 'Data completeness', prevalence: 'Prevalence', mean: 'Mean', min: 'Min', max: 'Max', sd: 'SD' }`
  - `<MapFigure entry={MapEntry} alt={string} caption?={ReactNode} size?={'thumb' | 'full'} />` — an `<img src={mapFileUrl(entry.file)} alt loading="lazy">` with `object-contain` inside an `aspect-[2/1]` frame on a neutral background; with `size="full"` (default) a button around the image opens a native `<dialog>` (via `ref.current.showModal()`) holding the same image at full width and a Close button; `size="thumb"` renders the image only (the card link around it handles clicks). Caption, when given, in a `<figcaption>`.
  - `mapAlt(kind: MapKind, traitName: string, levelName?: string): string` → `"Data completeness map of Flower color"`, `"Prevalence map of Flower color: red"`.

- [ ] **Step 1: Failing tests.**
  - `MapFigure.test.tsx`: renders an img with the file URL, `loading="lazy"` and the alt; `size="full"`: clicking the image button calls `HTMLDialogElement.prototype.showModal` (stub it with `vi.fn()` — jsdom lacks it) and the dialog holds a second img; Close calls `close`.
  - `MapsPage.test.tsx` (mock `../../api/dataset.ts` and `../../api/maps.ts` with `vi.hoisted` + `vi.mock` as `TraitPage.test.tsx` does; `fetchMe` with `permissions: ['dataset.read']`; `renderAt('/app/maps')`): given a dictionary of three categories (Seed: one quantitative trait with `mean` only; Flower: a categorical trait with completeness + prevalence, and a trait without maps; Fruit: no maps) — the jump bar lists `Seed` and `Flower` only, as links with `href` `#seed` / `#flower`, in dictionary order; each section (`id` = category key) shows one card per trait with maps, whose link goes to `/app/maps/<traitId>`; the Flower card's thumbnail is its completeness map, the Seed card's its `mean` map; the badges read Categorical / Quantitative; the trait without maps is absent; with `fetchMaps` resolving `[]` the page reads "No maps yet."
  - Nav: extend the existing assertion style of `AppShell.test.tsx` — a `dataset.read` session shows a `Maps` link to `/app/maps` placed right after `Traits`.

- [ ] **Step 2: Run to see them fail** — `docker exec "$C" sh -c 'cd apps/web && pnpm vitest run --project web --maxWorkers=3 --testTimeout=30000 src/components/maps src/pages/maps src/components/shell'` (check the actual project name in the root `vitest.config.ts`).

- [ ] **Step 3: Implement.** Nav entry: `{ to: '/app/maps', label: 'Maps', icon: 'map', permission: 'dataset.read', section: 'data' }` right after Traits. `MapsPage`: `useQuery` for `fetchDictionary()` (unfiltered, `datasetKeys.dictionary()`) and `useMaps()`; build `byTrait = mapsByTrait(maps)`; categories = dictionary categories filtered to those with at least one trait in `byTrait`; breadcrumb `useBreadcrumb([{ label: 'Maps' }])` (check how Species/Traits register theirs so it renders `Data › Maps`). Layout: page heading "Maps" and one line of intro ("Global maps per trait, by TDWG level 3 region."), then a `sticky top-0 z-10` nav bar (`aria-label="Trait categories"`) with one anchor per category, horizontally scrollable at phone width (`overflow-x-auto`, no wrap); then per category `<section id={key} aria-labelledby=…>` with an `<h2>` and a grid `grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` of cards: `<Link to="/app/maps/$traitId">` wrapping `<MapFigure size="thumb" …>`, the trait name (`humaniseKey(trait.key)`) and a `<Badge>` with Categorical / Quantitative. Add `scroll-margin-top` on sections so the sticky bar does not cover the heading. Follow the look of the existing catalog pages (read `TraitsPage.tsx` for heading, spacing and colour tokens; do not invent a new palette). Loading and error states as `TraitsPage` does.

  E2E (`apps/e2e/tests/maps.spec.ts`): logged in as the seeded admin, click **Maps** in the sidebar, expect the URL `/app/maps` and the text "No maps yet." (the production manifest is empty). Verify every asserted string against the component source; CI's `E2E` job runs it (it cannot run locally).

- [ ] **Step 4: Run** the scoped web tests, then the whole web suite once with `--maxWorkers=3 --testTimeout=30000`, then `pnpm lint && pnpm typecheck && pnpm rfc:check`. `docker cp "$C":/workspace/apps/web/src/routeTree.gen.ts` back into the worktree if the plugin changed it, and re-run lint on it.

- [ ] **Step 5: Commit** — `feat(web): Maps page with category jump bar (RFC-76 R6)` with the trailer.

---

### Task 4: Web — `/app/maps/$traitId`

**Files:**
- Create: `apps/web/src/routes/app/maps/$traitId.tsx`, `apps/web/src/pages/maps/TraitMapsPage.tsx` + `TraitMapsPage.test.tsx`
- Modify: `apps/web/src/routeTree.gen.ts` (regenerated, copied back)

**Interfaces:**
- Consumes: everything Task 3 produces; `fetchDictionary`, `datasetKeys`, `humaniseKey`, `useBreadcrumb`.
- Produces: the route `/app/maps/$traitId` (Task 5 links to it).

- [ ] **Step 1: Failing tests** (`TraitMapsPage.test.tsx`, same mocking style):
  1. Categorical trait with levels `white, red, blue` (dictionary `sortOrder` 1, 2, 3) and manifest rows in the order `blue`, completeness, `white` (no `red`): the completeness figure comes first; the prevalence grid shows exactly two figures, `white` then `blue` (dictionary order, not manifest order), each labelled with the level name; no empty frame for `red`. Alt texts via `mapAlt`.
  2. Quantitative trait with only `mean` and `sd`: a grid with two figures labelled Mean and SD, in the order Mean, Min, Max, SD minus the missing ones.
  3. Each caption reads `TDWG level 3 regions · 2026-09-01` (the row's `dataVersion`).
  4. Breadcrumb `Data › Maps › <category label> › <trait name>`, with Maps linking to `/app/maps` and the category crumb linking to `/app/maps#<categoryKey>` (use the `hash` option of TanStack `Link`/crumb if the `Crumb` type supports it; if it does not, link to `/app/maps` and say so in your report).
  5. Previous / next: the category has traits A, B, C in dictionary order, all with maps, and D without maps after C; on B the page links "Previous: A" and "Next: C"; on C there is no Next (D has no maps).
  6. A **Trait details** link to `/app/traits/<id>`.
  7. A trait id with no maps (or not in the dictionary) reads "No maps for this trait."

- [ ] **Step 2: Run to see them fail** (scoped web command as in Task 3).

- [ ] **Step 3: Implement.** Route file copies the shape of `routes/app/traits/$id.tsx` (no search params). Page: find the trait and its category in the dictionary; `entries = mapsByTrait(maps).get(traitId) ?? []`; completeness → `<MapFigure>` full width with caption; categorical → `trait.levels` sorted by `sortOrder`, each matched to its prevalence entry by `levelId`, grid `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`, each figure with an `<h3>` / label of the level name (`humaniseKey(level.key)`); quantitative → `(['mean','min','max','sd'] as const)` filtered to present kinds, grid `sm:grid-cols-2`, labelled with `MAP_KIND_LABELS`. Section headings: "Data completeness", "Prevalence by level", "Summary statistics". Header: trait name, category, Trait details link; footer: Previous / Next links.

- [ ] **Step 4: Run** scoped tests, whole web suite once, `pnpm lint && pnpm typecheck && pnpm rfc:check`; copy `routeTree.gen.ts` back.

- [ ] **Step 5: Commit** — `feat(web): per-trait maps page (RFC-76 R7)` with the trailer.

---

### Task 5: Web — links from the trait dictionary, and the handbook

**Files:**
- Modify: `apps/web/src/pages/dataset/TraitPage.tsx` (+ `TraitPage.test.tsx`): a `TraitMaps` section between `<Distribution/>` and `<TraitSpecies/>`
- Modify: `apps/web/src/pages/dataset/TraitsPage.tsx` (+ test): a map link in the name cell of `TraitRows`
- Modify: `apps/web/src/components/ui/HelpTip.tsx` (+ its test if one exists): optional `extraLink?: { to: string; label: string }` rendered next to "Learn more"
- Modify: `apps/web/src/components/dataset/TraitCard.tsx`, `apps/web/src/components/dataset/EmptyTraitCard.tsx` (+ their tests, or `SpeciesPage.test.tsx` if that is where cards are tested)
- Modify: `CLAUDE.md` — Layout bullet for `apps/web`: add the Maps pages (`/app/maps`, `/app/maps/$traitId`, RFC-76, `dataset.read`), the trait page's Maps section and the map files in `apps/api/maps` (manifest; procedure in `apps/api/maps/README.md`). Keep it one or two sentences in the existing style.

**Interfaces:**
- Consumes: `useMaps`, `mapsByTrait`, `MapFigure`, `mapAlt`, `MAP_KIND_LABELS` (Task 3); route `/app/maps/$traitId` (Task 4).
- Produces: nothing further.

- [ ] **Step 1: Failing tests.**
  - TraitPage: with maps for the trait → a section headed "Maps" containing the completeness thumbnail (`size="thumb"`, alt via `mapAlt`) and a link "See all maps for this trait →" to `/app/maps/<id>`; with maps but no completeness row → the link alone; with no maps → no "Maps" heading.
  - TraitsPage: a trait with maps shows a link with accessible name `Maps of <trait name>` to `/app/maps/<id>` (the `map` icon, `aria-label`); a trait without maps shows none.
  - Species trait card: a trait **with a description** and maps → the help popover holds "Learn more" and a "Maps" link to `/app/maps/<traitId>`; a trait **without a description** but with maps → the popover still renders, holding the Maps link; a trait with neither → no popover (unchanged behaviour). Same for the empty-trait card.

- [ ] **Step 2: Run to see them fail** (scoped web command).

- [ ] **Step 3: Implement.** Each component calls `useMaps()` itself (one cached query; no prop threading through the species page). `TraitCard`: `const hasMaps = (mapsByTrait(maps ?? []).get(trait.id) ?? []).length > 0;` render `HelpTip` when `tip || hasMaps`, children `tip ?? 'Global maps are available for this trait.'`, `extraLink={hasMaps ? { to: `/app/maps/${trait.id}`, label: 'Maps' } : undefined}` — or, if `HelpTip`'s `learnMore` link uses typed TanStack `Link` params, pass `to: '/app/maps/$traitId'` with params the same way. A failed maps query must never break the species page or trait page: treat an error as "no maps".

- [ ] **Step 4: Run** scoped tests, the whole web suite once, `pnpm lint && pnpm typecheck && pnpm rfc:check`.

- [ ] **Step 5: Commit** — `feat(web): trait dictionary links to its maps (RFC-76 R8)` and, separately, `docs: Maps pages in the handbook (RFC-76)`, both with the trailer.

# Revision 13i — Full Dataset Export (ZIP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim `GET /api/export/records.csv` (plan 13e) with `GET /api/export/dataset.zip`: `dataset.export`, audited, streamed. The ZIP holds `records.csv` (every visible, non-withdrawn record, with the 24 columns of spec R-17) and `annotations.csv` (one row per validation and per contest, with user names and never e-mail addresses). The species search's download link points to the new URL and gets a new label.

**Architecture:** `apps/api/src/dataset/export.ts` keeps `csvRow` and the postgres.js cursor-to-`ReadableStream` code, which becomes a private `csvStream` shared by two queries: `recordsCsv` and `annotationsCsv`. `datasetZip` passes both to `yazl`'s `addReadStreamLazy`, so they run **one after the other**: the annotations cursor opens only after `records.csv` has ended, so at most one pooled connection is in use. It returns `Readable.toWeb(zip.outputStream)`. yazl deflates each entry and switches to ZIP64 on its own once a size or offset passes 4 GiB. A client abort destroys the output stream, and that also destroys the entry currently being pumped, which cancels its cursor. The route resolves the visibility, writes the audit entry before the first byte, and passes `review = records.review` for spec R-14.

**Tech Stack:** Hono 4, postgres.js cursor, drizzle `sql` + `PgDialect`, Node 24 `stream` (`Readable.fromWeb` / `Readable.toWeb`), **yazl 3.3.1** (runtime), **yauzl 3.4.0** (tests only), Vitest 5 + testcontainers, React 19 (one link).

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` — R-13, R-14, R-17, §5 "ZIP", §6 (`record_code`, the quantitative columns, `record_references`, export row 13e/13i).

**Depends on:** 13a (RFC-66 amended for R-17), 13e (the interim `records.csv` route this plan replaces), 13f (`record_code`, `min_value`…`n`, `record_references`), 13g (the `resolve` annotation kind, contest records carrying a value, the withdrawal rules). Start only after 13g is merged to `main`.

## Global Constraints

- README non-negotiable rules: RFC first, TDD (failing test → code), **no DB mocks** (testcontainers), every exported symbol in `apps/*/src` carries `@rfc RFC-NN Rx`, English everywhere, strict inputs, PII (`users.name`) decrypted only in the API (RFC-40 R8), every route guarded (RFC-32) and visibility-resolving (RFC-33 R10).
- Exact pinned versions, compatible with `minimumReleaseAge: 10080` (7 days) in `pnpm-workspace.yaml`. Every version picked below was published more than 7 days before 2026-09-25.
- RFC citations: "RFC-66 R<n> (as amended by 13a for spec R-17)". This plan assumes 13a's numbering: **R1** route + permission, **R2** `records.csv` rows and columns, **R3** order, **R4** CSV and ZIP format + headers, **R5** streaming, **R6** audit, **R7** errors, **R8** `annotations.csv`. Task 1 Step 2 checks this against the merged RFC.
- Branch `feat/13i-full-export` from an up-to-date `main`. Before working, claim the 13i issue (README rule 7): `gh issue edit <n> --add-assignee @me --add-label in-progress`.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Verification runs in Docker** (this Mac has no Node). Once per session:

  ```sh
  docker run -d --name treerepro-13i -w /workspace \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
    -e TESTCONTAINERS_RYUK_DISABLED=true \
    treerepro-verify:base sleep infinity
  ```

  Before **every** test command, sync the worktree into the container (delete first; `COPYFILE_DISABLE=1`; never `find -delete`):

  ```sh
  docker exec treerepro-13i sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
  COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
      --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
      --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
    | docker exec -i treerepro-13i tar -x -C /workspace
  ```

  Below, "**sync**" means these two commands. Nothing the container writes comes back to the worktree: copy files out with `docker cp` when needed. E2E runs only in CI.

## File Structure

```
docs/rfc/60-dataset/66-dataset-export.md          # read only (13a); Changelog line if 13a left R8 open
docs/rfc/30-access/33-data-visibility.md          # R3 route list: dataset.zip
README.md                                         # Layout + Commands: the export line
apps/api/package.json, pnpm-lock.yaml             # + yazl 3.3.1; dev + @types/yazl 3.3.1, yauzl 3.4.0, @types/yauzl 3.4.0
apps/api/src/dataset/export.ts                    # RECORD_COLUMNS, ANNOTATION_COLUMNS, csvRow, recordsCsv, annotationsCsv, datasetZip
apps/api/src/dataset/export.test.ts               # column lists + csvRow (unit)
apps/api/src/dataset/export.property.test.ts      # unchanged (csvRow properties)
apps/api/src/dataset/export.integration.test.ts   # contents, review split, ZIP entries, cancel safety
apps/api/src/http/routes/dataset/export.ts        # GET /dataset.zip
apps/api/src/http/routes/dataset/export.integration.test.ts
apps/api/src/routes-guarded.integration.test.ts   # route list entry
apps/api/test/helpers/export.ts                   # test-only: parseCsv, readAll, unzip (yauzl)
apps/web/src/api/curation.ts (+ curation.test.ts) # EXPORT_DATASET_URL
apps/web/src/pages/dataset/SpeciesSearchPage.tsx (+ .test.tsx)  # "Export dataset (ZIP)"
```

## Library choice (ZIP)

| Candidate | ZIP64 | Streams in and out | Compression | Deps | Maintenance |
|---|---|---|---|---|---|
| **yazl 3.3.1** | automatic when needed | Node `Readable` in (`addReadStreamLazy`), `outputStream` out | deflate (zlib) | 1 (`buffer-crc32`) | stable, same author as yauzl |
| client-zip 2.5.1 | yes | Web streams | **store only** (a ~2 GB CSV stays ~2 GB) | 0 | active |
| fflate 0.8.3 | **no** | yes | deflate | 0 | active |
| @zip.js/zip.js 2.18.x | yes | Web streams | deflate | 0 | large; latest release is inside the cooldown |
| archiver 8.0.0 | yes | yes | deflate | 9 | heavy |

**Pick: yazl 3.3.1.** It is the smallest option that both deflates (CSV shrinks roughly 5–10×) and writes ZIP64 automatically, and `addReadStreamLazy` gives the one-cursor-at-a-time order for free. Its one dependency is `buffer-crc32`, and yauzl from the same author reads the output in tests.

Versions (all published before 2026-09-18): `yazl@3.3.1` (2024-11-23), `@types/yazl@3.3.1` (2026-04-07), `yauzl@3.4.0` (2026-06-07), `@types/yauzl@3.4.0` (2026-06-13).

---

### Task 1: Docs alignment and claim

**Files:** `docs/rfc/30-access/33-data-visibility.md`, `README.md`, `docs/rfc/60-dataset/66-dataset-export.md` (read only).

**Interfaces:** none (docs).

- [ ] **Step 1: Branch and claim**

```sh
git switch main && git pull --rebase && git switch -c feat/13i-full-export
gh issue list --search "13i in:title" --state open   # note the number <n>
gh issue edit <n> --add-assignee @me --add-label in-progress
```

- [ ] **Step 2: Read RFC-66 as amended by 13a** — `sed -n '1,80p' docs/rfc/60-dataset/66-dataset-export.md`. Check it describes `GET /api/export/dataset.zip`, the `records.csv` columns of spec R-17, and `annotations.csv`. Map the rule numbers to this plan's assumption (Global Constraints). If 13a numbered them differently, use 13a's numbers in every `@rfc` tag and test title below: change the tag, never the rule. If 13a did not set the audit metadata, the ZIP media type or the file name, this plan uses `{ format: 'zip', scope: 'dataset' }`, `application/zip` and `treerepro-dataset-<YYYY-MM-DD>.zip`. Add them to RFC-66 in this commit with a Changelog line `- 2026-09-25 — R4, R6: ZIP media type, file name and audit metadata (plan 13i).`

- [ ] **Step 3: RFC-33 R3** — in `docs/rfc/30-access/33-data-visibility.md` R3, replace the export route named there (`GET /api/export/accepted.csv`, or `GET /api/export/records.csv` if 13e renamed it) with `GET /api/export/dataset.zip (RFC-66 R2, R8)`. Add a Changelog line: `- 2026-09-25 — R3: the export route is GET /api/export/dataset.zip (plan 13i, spec R-17).`

- [ ] **Step 4: README** — `grep -n "api/export/\|Export accepted\|Export records" README.md`. In **Layout**, the link sentence becomes: `an **Export dataset (ZIP)** link (`dataset.export`) sits on the species search header`. In **Commands**, the export entry becomes: `` `GET /api/export/dataset.zip` (`dataset.export`, a streamed ZIP holding `records.csv` and `annotations.csv`, audited): RFC-66. ``

- [ ] **Step 5: Commit**

```sh
git add docs/rfc/30-access/33-data-visibility.md README.md docs/rfc/60-dataset/66-dataset-export.md
git commit -m "docs: dataset.zip replaces the interim records export (RFC-33 R3, RFC-66, plan 13i)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Dependencies and the test-only reader

**Files:** `apps/api/package.json`, `pnpm-lock.yaml`, create `apps/api/test/helpers/export.ts`.

**Interfaces — Produces (test-only):**
- `readAll(stream: ReadableStream<Uint8Array>): Promise<string>`: the stream's bytes as text, **with the BOM kept**.
- `parseCsv(text: string): { bom: boolean; header: string; rows: string[][] }`
- `unzip(bytes: ArrayBuffer | Uint8Array): Promise<Map<string, string>>`: entry names in archive order, each entry's text with the BOM kept.

- [ ] **Step 1: Add the packages inside the container and copy the manifests out**

```sh
# sync (see Global Constraints), then:
docker exec treerepro-13i sh -c 'cd /workspace && pnpm --filter @treerepro/api add -E yazl@3.3.1 && pnpm --filter @treerepro/api add -D -E @types/yazl@3.3.1 yauzl@3.4.0 @types/yauzl@3.4.0'
docker cp treerepro-13i:/workspace/apps/api/package.json apps/api/package.json
docker cp treerepro-13i:/workspace/pnpm-lock.yaml pnpm-lock.yaml
git diff --stat   # expect: apps/api/package.json, pnpm-lock.yaml only
```

Expected: `apps/api/package.json` lists `"yazl": "3.3.1"` under `dependencies` and `"@types/yazl": "3.3.1"`, `"@types/yauzl": "3.4.0"` and `"yauzl": "3.4.0"` under `devDependencies`, all without `^`. pnpm raises no `minimumReleaseAge` error.

- [ ] **Step 2: Write the helper** — `apps/api/test/helpers/export.ts`:

```ts
import { buffer } from 'node:stream/consumers';
import { fromBufferPromise } from 'yauzl';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** A stream's bytes as text. `Response.text()` would strip the BOM the export writes (RFC-66 R4). */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return decoder.decode(await new Response(stream).arrayBuffer());
}

/** RFC 4180 line → fields (quotes doubled inside quoted fields). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** One export CSV: BOM flag, the header line, and the data rows (the fixtures hold no line breaks). */
export function parseCsv(text: string): { bom: boolean; header: string; rows: string[][] } {
  const bom = text.startsWith('\uFEFF');
  const lines = (bom ? text.slice(1) : text).split('\r\n');
  if (lines.at(-1) !== '') throw new Error('the CSV does not end with CRLF');
  return { bom, header: lines[0] ?? '', rows: lines.slice(1, -1).map(parseLine) };
}

/** Every entry of a ZIP, in archive order, as text with the BOM kept. */
export async function unzip(bytes: ArrayBuffer | Uint8Array): Promise<Map<string, string>> {
  const zip = await fromBufferPromise(Buffer.from(bytes));
  const files = new Map<string, string>();
  for await (const entry of zip.eachEntry()) {
    files.set(entry.fileName, decoder.decode(await buffer(await zip.openReadStreamPromise(entry))));
  }
  return files;
}
```

- [ ] **Step 3: Typecheck** — sync, then `docker exec treerepro-13i sh -c 'cd /workspace && pnpm --filter @treerepro/api typecheck'`. Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add apps/api/package.json pnpm-lock.yaml apps/api/test/helpers/export.ts
git commit -m "build(api): yazl for the dataset ZIP, yauzl to read it in tests (plan 13i)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `records.csv` and `annotations.csv` streams

**Files:** Modify (full rewrite) `apps/api/src/dataset/export.ts`, `apps/api/src/dataset/export.test.ts`, `apps/api/src/dataset/export.integration.test.ts`. `export.property.test.ts` stays as it is: it imports only `csvRow`, which does not change.

**Interfaces:**
- Consumes: `speciesVisible`, `traitVisible`, `Visibility` (`access/visibility.ts`); `Db` (`db/client.ts`); `getPii().decrypt(stored, 'users.name')` (`security/pii.ts`); the tables `trait_records` (with 13f's `record_code`, `min_value`, `max_value`, `mean_value`, `sd_value`, `n`), `record_references`, `record_annotations` (kinds `confirm`, `withdraw`, `resolve`), `bibliographic_references`, `users`, `species`, `genera`, `families`, `traits`, `trait_categories`, `trait_levels`.
- Produces:
  - `RECORD_COLUMNS: readonly [24 names]`, `ANNOTATION_COLUMNS: readonly [6 names]`
  - `csvRow(fields: ReadonlyArray<string | number | null | undefined>): string` (unchanged)
  - `interface ExportOptions { review: boolean; batch?: number }`
  - `recordsCsv(db: Db, visibility: Visibility, options: ExportOptions): ReadableStream<Uint8Array>`
  - `annotationsCsv(db: Db, visibility: Visibility, options: ExportOptions): ReadableStream<Uint8Array>`

- [ ] **Step 1: Failing unit test** — replace `apps/api/src/dataset/export.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { ANNOTATION_COLUMNS, csvRow, RECORD_COLUMNS } from './export.ts';

describe('RFC-66 R4 csvRow', () => {
  it('joins with commas, ends with CRLF, quotes fields holding quotes, commas or line breaks', () => {
    expect(csvRow(['a', 'b', null, 3])).toBe('a,b,,3\r\n');
    expect(csvRow(['Smith, J.', 'say "hi"', 'two\nlines', 'cr\rhere'])).toBe(
      '"Smith, J.","say ""hi""","two\nlines","cr\rhere"\r\n',
    );
    expect(csvRow([''])).toBe('\r\n');
  });
});

describe('RFC-66 R2, R8 column lists', () => {
  it('R2 records.csv names the 24 columns of spec R-17 in order', () => {
    expect([...RECORD_COLUMNS]).toEqual([
      'record_code', 'family', 'genus', 'species', 'name_source', 'category', 'trait', 'unit', 'level',
      'value_single', 'value_min', 'value_max', 'value_mean', 'value_sd', 'value_n', 'raw_value',
      'references', 'origin', 'intent', 'responds_to', 'contested', 'n_validations', 'n_contests',
      'created_at',
    ]);
  });

  it('R8 annotations.csv names six columns and no e-mail', () => {
    expect([...ANNOTATION_COLUMNS]).toEqual([
      'record_code', 'kind', 'user_name', 'date', 'reference', 'contest_record_code',
    ]);
  });
});

describe('RFC-66 R4 csvField CSV formula injection guard', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
  ])('prefixes %j with a quote before RFC 4180 quoting', (input, expected) => {
    expect(csvRow([input])).toBe(`${expected}\r\n`);
  });

  it('quotes the prefixed field too when RFC 4180 also requires it', () => {
    expect(csvRow(['\rx'])).toBe(`"'\rx"\r\n`);
  });

  it('leaves a plain number unprefixed', () => {
    expect(csvRow([-12.5, '+3', '1e5'])).toBe('-12.5,+3,1e5\r\n');
  });
});
```

(Biome will reflow the arrays. Run `pnpm lint` in the container and copy its layout back by hand.)

- [ ] **Step 2: Shared fixture** — append to `apps/api/test/helpers/export.ts` (both the service test and the route test use it; a test file never imports another test file, since Vitest would register its suites twice). Add these imports at the top of the helper:

```ts
import { sql } from 'drizzle-orm';
import type { Db } from '../../src/db/client.ts';
import {
  createAnnotation,
  createFamily,
  createGenus,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from './dataset.ts';
import { createUser } from './users.ts';
```

and append:

```ts
export async function codeOf(db: Db, id: string): Promise<string> {
  const [row] = await db.execute<{ record_code: string }>(
    sql`select record_code from trait_records where id = ${id}`,
  );
  if (!row) throw new Error(`no record ${id}`);
  return row.record_code;
}

/**
 * One species with: r1 (red, 2 validators, contested by c1, one extra
 * reference), r1b (red, contested through its level), r2 (blue), w (red,
 * withdrawn, validated), p (pending), r3 (quantitative, six fields, contest c2
 * resolved). Every test owns its data.
 */
export async function exportScene(db: Db) {
  const family = await createFamily(db, { name: `Aaaceae-${Math.random().toString(16).slice(2)}` });
  const genus = await createGenus(db, { familyId: family.id });
  const sp = await createSpecies(db, { genusId: genus.id });
  const cat = await createTrait(db, { levels: ['red', 'blue'] });
  const quant = await createTrait(db, { valueType: 'quantitative', unit: 'mm' });
  const ref1 = await createReference(db, {
    citationKey: `Smith, J. "et al." ${Math.random().toString(16).slice(2)}`,
  });
  const ref2 = await createReference(db);
  const ref3 = await createReference(db);
  const { user: author } = await createUser(db, { name: 'Author One' });
  const { user: val1, email: val1Email } = await createUser(db, { name: 'Val One' });
  const { user: val2 } = await createUser(db, { name: 'Val Two' });
  const { user: contester } = await createUser(db, { name: 'Con Tester' });
  const red = cat.levels.find((l) => l.key === 'red')?.id as string;
  const blue = cat.levels.find((l) => l.key === 'blue')?.id as string;
  const mine = { speciesId: sp.id, origin: 'manual' as const, createdBy: author.id };
  const r1 = await createRecord(db, { ...mine, traitId: cat.id, levelId: red, valueText: 'red', primaryReferenceId: ref1.id });
  await db.execute(sql`insert into record_references (record_id, reference_id) values (${r1.id}, ${ref2.id})`);
  const r1b = await createRecord(db, { ...mine, traitId: cat.id, levelId: red, valueText: 'red', primaryReferenceId: ref3.id });
  const r2 = await createRecord(db, { ...mine, traitId: cat.id, levelId: blue, valueText: 'blue', primaryReferenceId: ref1.id });
  const w = await createRecord(db, { ...mine, traitId: cat.id, levelId: red, valueText: 'red', primaryReferenceId: ref2.id });
  const p = await createRecord(db, { ...mine, traitId: cat.id, valueText: 'reddish', primaryReferenceId: ref1.id });
  const [r3] = await db.execute<{ id: string }>(sql`
    insert into trait_records (species_id, trait_id, value_text, numeric_value, min_value, max_value,
      mean_value, sd_value, n, harmonisation, origin, created_by, primary_reference_id)
    values (${sp.id}, ${quant.id}, '12.5', 12.5, 1, 20, 10, 2.5, 8, 'harmonised', 'manual',
      ${author.id}, ${ref1.id})
    returning id`);
  if (!r3) throw new Error('r3 not inserted');
  const c1 = await createRecord(db, {
    speciesId: sp.id, traitId: cat.id, levelId: blue, valueText: 'blue', primaryReferenceId: ref3.id,
    origin: 'manual', createdBy: contester.id, intent: 'contest', respondsToRecordId: r1.id,
  });
  const c2 = await createRecord(db, {
    speciesId: sp.id, traitId: quant.id, numericValue: 99, valueText: '99', primaryReferenceId: ref1.id,
    origin: 'manual', createdBy: contester.id, intent: 'contest', respondsToRecordId: r3.id,
  });
  await createAnnotation(db, { recordId: r1.id, actorId: val1.id, kind: 'confirm' });
  await createAnnotation(db, { recordId: r1.id, actorId: val2.id, kind: 'confirm', referenceId: ref2.id });
  await createAnnotation(db, { recordId: w.id, actorId: val1.id, kind: 'confirm' });
  await createAnnotation(db, { recordId: w.id, actorId: author.id, kind: 'withdraw' });
  await createAnnotation(db, { recordId: c2.id, actorId: val2.id, kind: 'resolve' });
  const ids = { r1: r1.id, r1b: r1b.id, r2: r2.id, w: w.id, p: p.id, r3: r3.id, c1: c1.id, c2: c2.id };
  const code = Object.fromEntries(
    await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, await codeOf(db, id)])),
  ) as Record<keyof typeof ids, string>;
  return { family, genus, sp, cat, quant, ref1, ref2, ref3, val1Email, code };
}
```

- [ ] **Step 3: Failing integration test** — replace `apps/api/src/dataset/export.integration.test.ts` with:

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { exportScene, parseCsv, readAll } from '../../test/helpers/export.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { createDb } from '../db/client.ts';
import { ANNOTATION_COLUMNS, annotationsCsv, csvRow, RECORD_COLUMNS, recordsCsv } from './export.ts';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Rejects after `ms` if `promise` has not settled by then. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]);
}

describe('RFC-66 R2, R8 records.csv and annotations.csv', () => {
  const t = useTestDb();

  it('R2 one row per visible non-withdrawn record, with references, counts and the contested flag', async () => {
    const s = await exportScene(t.db);
    const csv = parseCsv(await readAll(recordsCsv(t.db, UNRESTRICTED, { review: true })));
    expect(csv.bom).toBe(true);
    expect(`${csv.header}\r\n`).toBe(csvRow(RECORD_COLUMNS));
    const byCode = new Map(csv.rows.map((r) => [r[0], r]));
    expect(byCode.get(s.code.r1)).toEqual([
      s.code.r1, s.family.name, s.genus.name, s.sp.canonicalName, 'wcvp', expect.any(String),
      s.cat.key, '', 'red', '', '', '', '', '', '', '',
      `${s.ref1.citationKey}; ${s.ref2.citationKey}`, 'manual', '', '', 'true', '2', '1',
      expect.stringMatching(ISO),
    ]);
    // R-8: the contest applies to every record of the contested level.
    expect(byCode.get(s.code.r1b)?.slice(20, 23)).toEqual(['true', '0', '1']);
    expect(byCode.get(s.code.r2)?.slice(20, 23)).toEqual(['false', '0', '0']);
    expect(byCode.get(s.code.c1)?.slice(8, 9)).toEqual(['blue']);
    expect(byCode.get(s.code.c1)?.slice(18, 20)).toEqual(['contest', s.code.r1]);
    // R-5 six quantitative fields; R-10 a resolved contest no longer flags, but still counts.
    expect(byCode.get(s.code.r3)?.slice(7, 16)).toEqual(['mm', '', '12.5', '1', '20', '10', '2.5', '8', '']);
    expect(byCode.get(s.code.r3)?.slice(20, 23)).toEqual(['false', '0', '1']);
    expect(byCode.get(s.code.c2)?.slice(9, 10)).toEqual(['99']);
    // R-14 pending shown to a reviewer, with its raw value.
    expect(byCode.get(s.code.p)?.slice(8, 16)).toEqual(['', '', '', '', '', '', '', 'reddish']);
    // R-13 withdrawn leaves the file.
    expect(byCode.has(s.code.w)).toBe(false);
  });

  it('R2 spec R-14: a viewer without records.review gets no pending record', async () => {
    const s = await exportScene(t.db);
    const csv = parseCsv(await readAll(recordsCsv(t.db, UNRESTRICTED, { review: false })));
    const codes = csv.rows.map((r) => r[0]);
    expect(codes).toContain(s.code.r1);
    expect(codes).not.toContain(s.code.p);
  });

  it('R8 one row per validation and per contest, user names only, withdrawn records left out', async () => {
    const s = await exportScene(t.db);
    const text = await readAll(annotationsCsv(t.db, UNRESTRICTED, { review: true }));
    const csv = parseCsv(text);
    expect(csv.bom).toBe(true);
    expect(`${csv.header}\r\n`).toBe(csvRow(ANNOTATION_COLUMNS));
    const mine = csv.rows.filter((r) => [s.code.r1, s.code.r3, s.code.w].includes(r[0] ?? ''));
    expect(mine).toHaveLength(4);
    for (const r of mine) expect(r[3]).toMatch(ISO);
    expect(mine.map((r) => [r[0], r[1], r[2], r[4], r[5]])).toEqual(
      expect.arrayContaining([
        [s.code.r1, 'validation', 'Val One', '', ''],
        [s.code.r1, 'validation', 'Val Two', s.ref2.citationKey, ''],
        [s.code.r1, 'contest', 'Con Tester', s.ref3.citationKey, s.code.c1],
        [s.code.r3, 'contest', 'Con Tester', s.ref1.citationKey, s.code.c2],
      ]),
    );
    expect(text).not.toContain(s.val1Email);
  });
});

describe('RFC-66 R5 connection safety', () => {
  let handle: ReturnType<typeof createDb> | undefined;

  afterAll(async () => {
    await handle?.close();
  });

  it('a client cancel during an in-flight batch fetch does not leak the pooled connection', async () => {
    handle = createDb(inject('databaseUrl'), { max: 1 });
    const { db } = handle;
    const trait = await createTrait(db, { levels: ['red'] });
    const ref = await createReference(db);
    const { user } = await createUser(db);
    for (let i = 0; i < 5; i++) {
      const sp = await createSpecies(db);
      await createRecord(db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'red',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }

    const reader = recordsCsv(db, UNRESTRICTED, { review: true, batch: 2 }).getReader();
    await reader.read();
    // Do not await this read before cancelling: it races the in-flight batch
    // fetch that `reader.cancel()` must wait for.
    const pending = reader.read();
    await reader.cancel();
    await pending.catch(() => undefined);

    await expect(withTimeout(db.execute(sql`select 1`), 5000)).resolves.toBeDefined();
  });
});
```


- [ ] **Step 4: Run the tests; they fail**

```sh
# sync, then:
docker exec treerepro-13i sh -c 'cd /workspace && pnpm vitest run --project api:unit src/dataset/export.test.ts'
docker exec treerepro-13i sh -c 'cd /workspace && pnpm vitest run --project api:integration src/dataset/export.integration.test.ts'
```

Expected: FAIL. `RECORD_COLUMNS`, `ANNOTATION_COLUMNS` and `annotationsCsv` are not exported by `./export.ts`.

- [ ] **Step 5: Implement** — replace `apps/api/src/dataset/export.ts` with:

```ts
import { type SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { Db } from '../db/client.ts';
import { getPii } from '../security/pii.ts';

/** @rfc RFC-66 R2 */
export const RECORD_COLUMNS = [
  'record_code',
  'family',
  'genus',
  'species',
  'name_source',
  'category',
  'trait',
  'unit',
  'level',
  'value_single',
  'value_min',
  'value_max',
  'value_mean',
  'value_sd',
  'value_n',
  'raw_value',
  'references',
  'origin',
  'intent',
  'responds_to',
  'contested',
  'n_validations',
  'n_contests',
  'created_at',
] as const;

/** User names only, never e-mail addresses (RFC-40). @rfc RFC-66 R8 */
export const ANNOTATION_COLUMNS = [
  'record_code',
  'kind',
  'user_name',
  'date',
  'reference',
  'contest_record_code',
] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A field starting with `=`, `+`, `-`, `@`, tab or CR is interpreted as a
 * formula by spreadsheet software; prefixing it with `'` keeps it inert
 * without changing the value a plain CSV reader sees. Never applied to a
 * plain number, which spreadsheet software never treats as a formula.
 * @rfc RFC-66 R4
 */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One RFC 4180 line, CRLF-terminated. @rfc RFC-66 R4 */
export function csvRow(fields: ReadonlyArray<string | number | null | undefined>): string {
  return `${fields.map(csvField).join(',')}\r\n`;
}

/**
 * `review`: the viewer holds `records.review`, so records whose
 * harmonisation is not `harmonised` are theirs to see (spec R-14). `batch`
 * is injectable so tests can force several small batches.
 * @rfc RFC-66 R2, R5
 */
export interface ExportOptions {
  review: boolean;
  batch?: number;
}

const BATCH = 500;

// Renders the drizzle `sql` templates below to text plus positional
// parameters. The visibility predicates (`speciesVisible`, `traitVisible`:
// RFC-33 R2) are drizzle fragments; the streaming cursor is postgres.js's.
const dialect = new PgDialect();

/**
 * A query as a CSV stream: a postgres.js cursor feeds a `ReadableStream`
 * batch by batch, so the file is never held in memory. The BOM lets
 * spreadsheet software read UTF-8.
 */
function csvStream<Row extends object>(
  db: Db,
  query: SQL,
  header: readonly string[],
  toLine: (row: Row) => string,
  batch: number,
): ReadableStream<Uint8Array> {
  const client = db.$client;
  const encoder = new TextEncoder();
  const rendered = dialect.sqlToQuery(query);
  // `unsafe` only in postgres.js's sense of "text I did not template": the
  // text is a constant with `$n` placeholders, and every value — the
  // viewer's plot ids — travels as a bound parameter.
  const cursor = client
    .unsafe<Row[]>(rendered.sql, rendered.params as Parameters<typeof client.unsafe>[1])
    .cursor(batch);
  const batches = cursor[Symbol.asyncIterator]();
  // postgres.js's cursor iterator implements `return()` as "resolve the
  // previous batch's continuation with CLOSE"; `next()` consumes that
  // continuation before starting its own fetch. So a `cancel()` that fires
  // while a `next()` is in flight finds nothing left to resolve: the arriving
  // batch then awaits a continuation nobody resolves, and the pooled
  // connection never comes back. `inflight` lets `cancel()` wait for that
  // fetch first — the same thing a plain `for await` loop gets for free.
  let inflight: Promise<IteratorResult<Row[]>> | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${csvRow(header)}`));
    },
    async pull(controller) {
      inflight = batches.next();
      let next: IteratorResult<Row[]>;
      try {
        next = await inflight;
      } finally {
        inflight = null;
      }
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value.map(toLine).join('')));
    },
    async cancel() {
      if (inflight) await inflight.catch(() => undefined);
      await batches.return?.();
    },
  });
}

/**
 * The exported records, over `trait_records r` joined to `species s` and
 * `traits t`: visible to the viewer (RFC-33 R2), not withdrawn (spec R-13),
 * and harmonised unless the viewer reviews (spec R-14).
 */
function exportable(visibility: Visibility, review: boolean): SQL {
  return sql`${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
    and ${traitVisible(visibility, sql`t.active`)}
    and not exists (select 1 from record_annotations w where w.record_id = r.id and w.kind = 'withdraw')
    and ${review ? sql`true` : sql`r.harmonisation = 'harmonised'`}`;
}

/** A reference as the export names it: its citation key, or `Personal observation`. */
const REF_LABEL = sql`case when b.kind = 'personal_observation' then 'Personal observation' else b.citation_key end`;

/** Record `r`'s references, `; `-joined: primary, secondary, then `record_references` (spec R-4). */
function referencesOf(r: SQL): SQL {
  return sql`(select string_agg(${REF_LABEL}, '; ' order by x.pos, b.citation_key)
    from (select ${r}.primary_reference_id as id, 0 as pos
          union all select ${r}.secondary_reference_id, 1
          union all select rr.reference_id, 2 from record_references rr where rr.record_id = ${r}.id) x
    join bibliographic_references b on b.id = x.id)`;
}

/** The contests (not withdrawn) that apply to record `r`: to it, or to any record of its level (spec R-8). */
const CONTESTS_OF_R = sql`from contests k where (k.target_id = r.id
  or (k.level_id is not null and k.species_id = r.species_id and k.trait_id = r.trait_id and k.level_id = r.level_id))`;

interface RecordRow {
  record_code: string;
  family: string | null;
  genus: string | null;
  species: string;
  name_source: string;
  category: string;
  trait: string;
  unit: string | null;
  level: string | null;
  value_single: string | null;
  value_min: string | null;
  value_max: string | null;
  value_mean: string | null;
  value_sd: string | null;
  value_n: number | null;
  raw_value: string | null;
  refs: string | null;
  origin: string;
  intent: string | null;
  responds_to: string | null;
  contested: boolean;
  n_validations: number;
  n_contests: number;
  created_at: Date;
}

/**
 * `records.csv`: every visible, non-withdrawn record, pending ones included
 * for a reviewer with their raw value. `n_validations` and `n_contests` count
 * distinct users; `contested` is spec R-9 (a contest neither withdrawn nor
 * resolved).
 * @rfc RFC-66 R2, R3, R4, R5
 * @rfc RFC-33 R2, R3
 */
export function recordsCsv(
  db: Db,
  visibility: Visibility,
  options: ExportOptions,
): ReadableStream<Uint8Array> {
  const query = sql`
    with contests as materialized (
      select k.id, k.created_by, tgt.id as target_id, tgt.species_id, tgt.trait_id, tgt.level_id,
        exists (select 1 from record_annotations z where z.record_id = k.id and z.kind = 'resolve') as resolved
      from trait_records k
      join trait_records tgt on tgt.id = k.responds_to_record_id
      where k.intent = 'contest'
        and not exists (select 1 from record_annotations w where w.record_id = k.id and w.kind = 'withdraw'))
    select r.record_code, f.name as family, g.name as genus, s.canonical_name as species, s.name_source,
      c.key as category, t.key as trait, t.unit, l.key as level,
      r.numeric_value::text as value_single, r.min_value::text as value_min,
      r.max_value::text as value_max, r.mean_value::text as value_mean,
      r.sd_value::text as value_sd, r.n as value_n,
      coalesce(r.raw_value, case when r.harmonisation <> 'harmonised' then r.value_text end) as raw_value,
      ${referencesOf(sql`r`)} as refs,
      r.origin, r.intent,
      (select x.record_code from trait_records x where x.id = r.responds_to_record_id) as responds_to,
      exists (select 1 ${CONTESTS_OF_R} and not k.resolved) as contested,
      (select count(distinct a.actor_id) from record_annotations a
        where a.record_id = r.id and a.kind = 'confirm')::int as n_validations,
      (select count(distinct k.created_by) ${CONTESTS_OF_R})::int as n_contests,
      r.created_at
    from trait_records r
    join species s on s.id = r.species_id
    left join genera g on g.id = s.genus_id
    left join families f on f.id = g.family_id
    join traits t on t.id = r.trait_id
    join trait_categories c on c.key = t.category_key
    left join trait_levels l on l.id = r.level_id
    where ${exportable(visibility, options.review)}
    order by f.name nulls last, g.name nulls last, s.canonical_name, t.key, r.record_code`;
  return csvStream<RecordRow>(
    db,
    query,
    RECORD_COLUMNS,
    (r) =>
      csvRow([
        r.record_code,
        r.family,
        r.genus,
        r.species,
        r.name_source,
        r.category,
        r.trait,
        r.unit,
        r.level,
        r.value_single,
        r.value_min,
        r.value_max,
        r.value_mean,
        r.value_sd,
        r.value_n,
        r.raw_value,
        r.refs,
        r.origin,
        r.intent,
        r.responds_to,
        r.contested ? 'true' : 'false',
        r.n_validations,
        r.n_contests,
        new Date(r.created_at).toISOString(),
      ]),
    options.batch ?? BATCH,
  );
}

interface AnnotationRow {
  record_code: string;
  kind: 'validation' | 'contest';
  /** Ciphertext (RFC-40 R2): the raw cursor bypasses `encryptedText`. */
  user_name: string;
  date: Date;
  reference: string | null;
  contest_record_code: string | null;
}

/**
 * `annotations.csv`: one row per validation (`confirm` annotation) and per
 * contest record, on exported records only. A validation names its
 * supporting reference; a contest names the contested record and its own
 * code and references. `user_name` is decrypted here, in the API process
 * (RFC-40 R8); no e-mail is ever read.
 * @rfc RFC-66 R4, R5, R8
 * @rfc RFC-33 R2, R3
 * @rfc RFC-40 R1, R8
 */
export function annotationsCsv(
  db: Db,
  visibility: Visibility,
  options: ExportOptions,
): ReadableStream<Uint8Array> {
  const query = sql`
    select x.record_code, x.kind, x.user_name, x.date, x.reference, x.contest_record_code from (
      select r.record_code, 'validation' as kind, u.name as user_name, a.created_at as date,
        ${REF_LABEL} as reference, null::text as contest_record_code, a.id as seq
      from record_annotations a
      join trait_records r on r.id = a.record_id
      join species s on s.id = r.species_id
      join traits t on t.id = r.trait_id
      join users u on u.id = a.actor_id
      left join bibliographic_references b on b.id = a.reference_id
      where a.kind = 'confirm' and ${exportable(visibility, options.review)}
      union all
      select tgt.record_code, 'contest', u.name, r.created_at, ${referencesOf(sql`r`)}, r.record_code, r.id
      from trait_records r
      join trait_records tgt on tgt.id = r.responds_to_record_id
      join species s on s.id = r.species_id
      join traits t on t.id = r.trait_id
      join users u on u.id = r.created_by
      where r.intent = 'contest' and ${exportable(visibility, options.review)}
    ) x
    order by x.record_code, x.date, x.seq`;
  const pii = getPii();
  return csvStream<AnnotationRow>(
    db,
    query,
    ANNOTATION_COLUMNS,
    (r) =>
      csvRow([
        r.record_code,
        r.kind,
        pii.decrypt(r.user_name, 'users.name'),
        new Date(r.date).toISOString(),
        r.reference,
        r.contest_record_code,
      ]),
    options.batch ?? BATCH,
  );
}
```

- [ ] **Step 6: Run the tests; they pass** — sync, then the two commands of Step 4, plus the property test, which is unchanged: `docker exec treerepro-13i sh -c 'cd /workspace && pnpm vitest run --project api:unit src/dataset/export.property.test.ts'`. Expected: all PASS. If the `r1` row fails only on `references`, check how 13d/13f label a `book` reference. This plan uses `citation_key` for every kind except `personal_observation`.

- [ ] **Step 7: Commit**

```sh
git add apps/api/src/dataset/export.ts apps/api/src/dataset/export.test.ts apps/api/src/dataset/export.integration.test.ts apps/api/test/helpers/export.ts
git commit -m "feat(api): records.csv and annotations.csv streams (RFC-66 R2, R8; spec R-17)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `datasetZip`, a streamed ZIP

**Files:** Modify `apps/api/src/dataset/export.ts`, `apps/api/src/dataset/export.integration.test.ts`.

**Interfaces:**
- Consumes: `recordsCsv`, `annotationsCsv`, `ExportOptions` (Task 3); `ZipFile` from `yazl`; `Readable` from `node:stream`.
- Produces: `datasetZip(db: Db, visibility: Visibility, options: ExportOptions & { now: Date }): ReadableStream<Uint8Array>`

- [ ] **Step 1: Failing tests** — in `export.integration.test.ts`, extend the imports:

```ts
import { exportScene, parseCsv, readAll, unzip } from '../../test/helpers/export.ts';
import { ANNOTATION_COLUMNS, annotationsCsv, csvRow, datasetZip, RECORD_COLUMNS, recordsCsv } from './export.ts';
```

Add this test inside `describe('RFC-66 R2, R8 records.csv and annotations.csv', …)`:

```ts
  it('R4 the ZIP holds records.csv then annotations.csv, each a BOM-led RFC 4180 file', async () => {
    const s = await exportScene(t.db);
    const zip = datasetZip(t.db, UNRESTRICTED, { review: true, now: new Date() });
    const files = await unzip(await new Response(zip).arrayBuffer());
    expect([...files.keys()]).toEqual(['records.csv', 'annotations.csv']);
    const records = parseCsv(files.get('records.csv') ?? '');
    const annotations = parseCsv(files.get('annotations.csv') ?? '');
    expect(records.bom && annotations.bom).toBe(true);
    expect(`${records.header}\r\n`).toBe(csvRow(RECORD_COLUMNS));
    expect(`${annotations.header}\r\n`).toBe(csvRow(ANNOTATION_COLUMNS));
    expect(records.rows.map((r) => r[0])).toContain(s.code.r1);
    expect(annotations.rows.map((r) => r[5])).toContain(s.code.c1);
  });
```

Add this test inside `describe('RFC-66 R5 connection safety', …)`. It reuses the `max: 1` handle, so it goes after the existing test and opens its own handle when that one is absent:

```ts
  it('cancelling the ZIP mid-entry releases the cursor of the entry being written', async () => {
    handle ??= createDb(inject('databaseUrl'), { max: 1 });
    const { db } = handle;
    const trait = await createTrait(db, { valueType: 'quantitative', unit: 'mm' });
    const sp = await createSpecies(db);
    const ref = await createReference(db);
    const { user } = await createUser(db);
    // Enough rows that the cursor is still open when the client goes away:
    // the pipe's buffers and deflate hold far less than 20 000 rows.
    await db.execute(sql`
      insert into trait_records (species_id, trait_id, value_text, numeric_value, harmonisation,
        origin, created_by, primary_reference_id)
      select ${sp.id}, ${trait.id}, g::text, g, 'harmonised', 'manual', ${user.id}, ${ref.id}
      from generate_series(1, 20000) g`);

    const reader = datasetZip(db, UNRESTRICTED, { review: true, now: new Date(), batch: 50 }).getReader();
    await reader.read();
    await reader.cancel();

    await expect(withTimeout(db.execute(sql`select 1`), 5000)).resolves.toBeDefined();
  });
```

- [ ] **Step 2: Run; it fails**

```sh
# sync, then:
docker exec treerepro-13i sh -c 'cd /workspace && pnpm vitest run --project api:integration src/dataset/export.integration.test.ts'
```

Expected: FAIL. `datasetZip` is not exported.

- [ ] **Step 3: Implement** — in `apps/api/src/dataset/export.ts` add the imports:

```ts
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
```

and append:

```ts
/**
 * The full dataset as one ZIP: `records.csv`, then `annotations.csv`,
 * deflated. yazl pumps its entries one at a time and opens the lazy one only
 * when its turn comes, so the two cursors never hold two pooled connections
 * at once. ZIP64 is written as soon as a size or offset needs it. A client
 * abort cancels the returned stream, which destroys yazl's output; that
 * `close` destroys the entry being pumped, which cancels its cursor (the
 * `cancel()` of `csvStream`). A failing query destroys the output with the
 * error, so the download ends cut short instead of looking complete. yazl
 * attaches no `error` listener to its input, so this function attaches one.
 * @rfc RFC-66 R4, R5
 */
export function datasetZip(
  db: Db,
  visibility: Visibility,
  options: ExportOptions & { now: Date },
): ReadableStream<Uint8Array> {
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  let current: Readable | null = null;
  const entry = (name: string, csv: () => ReadableStream<Uint8Array>) => {
    zip.addReadStreamLazy(name, { mtime: options.now }, (cb) => {
      const source = Readable.fromWeb(csv());
      source.once('error', (err) => output.destroy(err));
      current = source;
      cb(null, source);
    });
  };
  entry('records.csv', () => recordsCsv(db, visibility, options));
  entry('annotations.csv', () => annotationsCsv(db, visibility, options));
  zip.once('error', (err: Error) => output.destroy(err));
  output.once('close', () => current?.destroy());
  zip.end();
  return Readable.toWeb(output);
}
```

- [ ] **Step 4: Run; both pass. Then prove the cancel test can fail** — sync and run Step 2's command: PASS. Then delete the line `output.once('close', () => current?.destroy());`, sync, and run again. Expected: the cancel test fails with `timed out after 5000ms`. If it still passes, raise `generate_series(1, 20000)` to `200000` and repeat until it fails. Restore the line, sync, run again: PASS.

- [ ] **Step 5: Typecheck and lint** — `docker exec treerepro-13i sh -c 'cd /workspace && pnpm --filter @treerepro/api typecheck && pnpm lint'`. Expected: PASS. If `Readable.toWeb(output)` is reported as not assignable to `ReadableStream<Uint8Array>`, write `return Readable.toWeb(output) as ReadableStream<Uint8Array>;`.

- [ ] **Step 6: Commit**

```sh
git add apps/api/src/dataset/export.ts apps/api/src/dataset/export.integration.test.ts
git commit -m "feat(api): streamed dataset ZIP with yazl, one cursor at a time (RFC-66 R4, R5)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Route `GET /api/export/dataset.zip`

**Files:** Modify (full rewrite) `apps/api/src/http/routes/dataset/export.ts` and `apps/api/src/http/routes/dataset/export.integration.test.ts`; modify `apps/api/src/routes-guarded.integration.test.ts`.

**Interfaces:**
- Consumes: `datasetZip` (Task 4); `visibilityOf`; `recordAudit`; `requirePermission`, `currentPermissions` (`http/middleware/require-permission.ts`); `currentUser`.
- Produces: `exportRoutes(ctx: AuthContext)`, mounted by `datasetRoutes` at `/export` (unchanged in `routes/dataset/index.ts`). It serves `GET /api/export/dataset.zip`.

- [ ] **Step 1: Failing test** — replace `apps/api/src/http/routes/dataset/export.integration.test.ts` with:

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  addPlotSpecies,
  assignPlots,
  createPlot,
  createRecord,
  createSpecies,
  createVisibilityFixture,
} from '../../../../test/helpers/dataset.ts';
import { exportScene, parseCsv, unzip } from '../../../../test/helpers/export.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

describe('RFC-66 GET /api/export/dataset.zip', () => {
  const t = useTestApp();

  it('R1, R4, R6 streams the ZIP with its headers, audits the download, and names no e-mail', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.export', 'records.review'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const s = await exportScene(t.db);

    const res = await call(t.app, 'GET', '/api/export/dataset.zip', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="treerepro-dataset-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    const files = await unzip(await res.arrayBuffer());
    expect([...files.keys()]).toEqual(['records.csv', 'annotations.csv']);
    const codes = parseCsv(files.get('records.csv') ?? '').rows.map((r) => r[0]);
    expect(codes).toContain(s.code.r1);
    expect(codes).toContain(s.code.p); // records.review: pending included (spec R-14)
    expect(codes).not.toContain(s.code.w); // withdrawn (spec R-13)
    expect(files.get('annotations.csv')).not.toContain(s.val1Email);
    const audit = await lastAudit(t.db, 'dataset.exported', { actorUserId: user.id });
    expect(audit?.metadata).toEqual({ format: 'zip', scope: 'dataset' });
  });

  it('RFC-33 R9, RFC-66 R2 a plot-bound viewer without records.review gets only the visible, harmonised rows', async () => {
    const managerRole = await createRole(t.db, {
      permissions: ['dataset.export', 'dataset.read_inactive', 'records.review'],
    });
    const contributorRole = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user: manager } = await createUser(t.db, { roles: [managerRole.id] });
    const { user: contributor } = await createUser(t.db, { roles: [contributorRole.id] });
    const f = await createVisibilityFixture(t.db, manager.id);
    const outsideSpecies = await createSpecies(t.db);
    const outsidePlot = await createRecord(t.db, {
      speciesId: outsideSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'one',
      levelId: f.activeTrait.levels[0]?.id,
      primaryReferenceId: f.reference.id,
      origin: 'manual',
      createdBy: manager.id,
    });
    const pending = await createRecord(t.db, {
      speciesId: f.shownSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'uno',
      primaryReferenceId: f.reference.id,
      origin: 'manual',
      createdBy: manager.id,
    });
    const plot = await createPlot(t.db);
    await addPlotSpecies(t.db, plot.id, [f.shownSpecies.id, f.hiddenSpecies.id]);
    await assignPlots(t.db, contributor.id, [plot.id], true);
    const ids = [f.onHiddenSpecies.id, f.onInactiveTrait.id, f.visible.id, outsidePlot.id, pending.id];
    const codes = await t.db.execute<{ id: string; record_code: string }>(
      sql`select id, record_code from trait_records where id = any(${ids}::uuid[])`,
    );
    const codeOf = new Map(codes.map((r) => [r.id, r.record_code]));
    const exported = async (cookie: string) => {
      const res = await call(t.app, 'GET', '/api/export/dataset.zip', { cookie });
      expect(res.status).toBe(200);
      const files = await unzip(await res.arrayBuffer());
      const got = new Set(parseCsv(files.get('records.csv') ?? '').rows.map((r) => r[0]));
      return ids.filter((id) => got.has(codeOf.get(id) ?? ''));
    };

    expect(await exported((await loginAs(t, manager)).cookie)).toEqual(ids);
    expect(await exported((await loginAs(t, contributor)).cookie)).toEqual([f.visible.id]);
  });

  it('R7 an unauthenticated request keeps the JSON error envelope', async () => {
    const res = await call(t.app, 'GET', '/api/export/dataset.zip');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('R1 without dataset.export the answer is 403', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'GET', '/api/export/dataset.zip', { cookie });
    expect(res.status).toBe(403);
  });
});
```


In `apps/api/src/routes-guarded.integration.test.ts`, replace the export entry in the expected route list (`'GET /api/export/accepted.csv'`, or `'GET /api/export/records.csv'` after 13e) with `'GET /api/export/dataset.zip'`.

- [ ] **Step 2: Run; it fails**

```sh
# sync, then:
docker exec treerepro-13i sh -c 'cd /workspace && pnpm vitest run --project api:integration src/http/routes/dataset/export.integration.test.ts src/routes-guarded.integration.test.ts'
```

Expected: FAIL. `/api/export/dataset.zip` answers 404, and the guarded-routes list differs.

- [ ] **Step 3: Implement** — replace `apps/api/src/http/routes/dataset/export.ts` with:

```ts
import { Hono } from 'hono';
import { visibilityOf } from '../../../access/visibility.ts';
import { recordAudit } from '../../../audit/audit.ts';
import type { AuthContext } from '../../../auth/context.ts';
import { datasetZip } from '../../../dataset/export.ts';
import type { AppEnv } from '../../env.ts';
import { currentPermissions, requirePermission } from '../../middleware/require-permission.ts';
import { currentUser } from '../../middleware/session.ts';

/**
 * File download: the RFC-11 R2 exception. The viewer's visibility is resolved
 * here and handed down, like every other dataset read (RFC-33 R1, R3);
 * `records.review` decides whether unharmonised records are included (spec R-14).
 * @rfc RFC-66 R1, R2, R4, R6, R7
 * @rfc RFC-33 R1, R3
 */
export function exportRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>().get(
    '/dataset.zip',
    requirePermission(ctx, 'dataset.export'),
    async (c) => {
      // Resolved before the audit entry: a viewer that cannot be resolved is
      // an export that never started (RFC-66 R6).
      const visibility = await visibilityOf(ctx, c);
      await recordAudit(ctx.db, {
        actorUserId: currentUser(c).id,
        action: 'dataset.exported',
        metadata: { format: 'zip', scope: 'dataset' },
      });
      const now = new Date(ctx.now());
      const day = now.toISOString().slice(0, 10);
      c.header('Content-Type', 'application/zip');
      c.header('Content-Disposition', `attachment; filename="treerepro-dataset-${day}.zip"`);
      c.header('Cache-Control', 'no-store');
      return c.body(
        datasetZip(ctx.db, visibility, {
          review: currentPermissions(c).has('records.review'),
          now,
        }),
      );
    },
  );
}
```

- [ ] **Step 4: Run; it passes** — sync, then Step 2's command, and also the two meta-tests:

```sh
docker exec treerepro-13i sh -c 'cd /workspace && pnpm vitest run --project api:integration src/routes-visibility.integration.test.ts src/routes-guarded.integration.test.ts src/http/routes/dataset/export.integration.test.ts'
```

Expected: PASS. The visibility meta-test (RFC-33 R10) lists the route and sees `visibilityOf` resolved. It never reads the body. The first entry's cursor opens as soon as yazl starts pumping, just as the CSV route's first `pull` used to. If the run hangs at teardown, add `await res.body?.cancel();` right after the status check in that test's loop, and say so in the PR.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/http/routes/dataset/export.ts apps/api/src/http/routes/dataset/export.integration.test.ts apps/api/src/routes-guarded.integration.test.ts
git commit -m "feat(api): GET /api/export/dataset.zip replaces the interim CSV export (RFC-66 R1, R6; spec R-17)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The download link on the species search

**Files:** `apps/web/src/api/curation.ts`, `apps/web/src/api/curation.test.ts`, `apps/web/src/pages/dataset/SpeciesSearchPage.tsx`, `apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx`.

**Interfaces:** Produces `EXPORT_DATASET_URL = '/api/export/dataset.zip'`. It replaces the export constant 13e left behind (`EXPORT_ACCEPTED_URL` today; locate it with `grep -rn "api/export/" apps/web/src`).

- [ ] **Step 1: Failing tests** — in `SpeciesSearchPage.test.tsx`, replace the two export tests with:

```tsx
  it('RFC-66 R1 shows the dataset export link only with dataset.export', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    auth.fetchMe.mockResolvedValue({ ...ME, permissions: ['dataset.read', 'dataset.export'] });
    renderAt('/app/species');
    const link = await screen.findByRole('link', { name: 'Export dataset (ZIP)' });
    expect(link).toHaveAttribute('href', '/api/export/dataset.zip');
    expect(link).toHaveAttribute('download');
  });

  it('hides the export link without dataset.export', async () => {
    dataset.searchSpecies.mockResolvedValue(page([]));
    await openPage();
    await screen.findByRole('heading', { level: 1, name: 'Species' });
    expect(screen.queryByRole('link', { name: /export dataset/i })).not.toBeInTheDocument();
  });
```

In `curation.test.ts`, import `EXPORT_DATASET_URL` in place of the old constant and change the assertion to `expect(EXPORT_DATASET_URL).toBe('/api/export/dataset.zip');`.

- [ ] **Step 2: Run; they fail**

```sh
# sync, then:
docker exec treerepro-13i sh -c 'cd /workspace && pnpm --filter @treerepro/web test -- src/pages/dataset/SpeciesSearchPage.test.tsx src/api/curation.test.ts'
```

Expected: FAIL. There is no link named "Export dataset (ZIP)", and `EXPORT_DATASET_URL` is not exported.

- [ ] **Step 3: Implement** — in `apps/web/src/api/curation.ts`, the constant becomes:

```ts
/** The full dataset download of RFC-66; a plain link, the session cookie authenticates it. @rfc RFC-66 R1 */
export const EXPORT_DATASET_URL = '/api/export/dataset.zip';
```

In `SpeciesSearchPage.tsx`, import `EXPORT_DATASET_URL` in place of the old constant. Use it as the anchor's `href`, and set the anchor text to `Export dataset (ZIP)`. The anchor keeps `download` and `buttonClassName({ variant: 'secondary' })`. In the component's JSDoc, the sentence "The export link is a plain download, gated by dataset.export." stays as it is.

- [ ] **Step 4: Run; they pass** — sync, then Step 2's command. Expected: PASS. Then `grep -rn "api/export/\(accepted\|records\)" apps packages` returns nothing.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/api/curation.ts apps/web/src/api/curation.test.ts apps/web/src/pages/dataset/SpeciesSearchPage.tsx apps/web/src/pages/dataset/SpeciesSearchPage.test.tsx
git commit -m "feat(web): Export dataset (ZIP) link on the species search (RFC-66 R1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Close-out

- [ ] **Step 1: Rebase on the current `main`** (rule 1 of epic #85: rebase, never merge). Run `git fetch origin && git rebase origin/main`. `main` moves during a run, so do it again right before the PR.
- [ ] **Step 2: Full pipeline** — sync, then:

```sh
docker exec treerepro-13i sh -c 'cd /workspace && pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test'
```

Expected: all green. For any failure outside this plan's files, run the same suite on plain `main` in a fresh container from `treerepro-verify:base` and compare counts before calling it pre-existing.
- [ ] **Step 3: CodeRabbit locally** on the branch before the PR (the `coderabbit:code-review` skill; hourly quota). Apply the findings, re-verify, and commit.
- [ ] **Step 4: Push and open the PR** — `git -c http.version=HTTP/1.1 push -u origin feat/13i-full-export`, then `gh pr create --title "feat: full dataset export as a streamed ZIP (plan 13i)" --body "…Closes #<n>…"`. The body lists the Spec notes below and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. CI's `E2E` job covers end to end. No E2E spec asserts the export link: `grep -rn "Export accepted\|api/export" apps/e2e` returns nothing.
- [ ] **Step 5: After the merge** — `gh issue edit <n> --remove-label in-progress`, and `docker rm -f treerepro-13i`.

## Spec notes (ambiguities resolved minimally)

1. **`references` content.** The spec's record item (§6) lists primary, then `record_references`. Imported records also carry `secondary_reference_id`, and the file has no other column for it, so the export lists **primary, secondary, then `record_references`** (by citation key), joined by `; `. A reference prints as its `citation_key`, or `Personal observation` for that kind (RFC-66's existing label). A `book` reference (13d) prints its `citation_key` too.
2. **`raw_value`.** The stored `raw_value`, or, for a record that is not `harmonised`, its `value_text`. Pending rows then carry the text the source gave. Harmonised manual rows leave it empty.
3. **Pending rows and R-14.** They are included only when the viewer holds `records.review`, read with `currentPermissions(c)` in the route. `dataset.export` is admin-only by default, and admin holds `records.review`, so the owner sees them. A custom role with only `dataset.export` does not. If 13g added a review flag to `Visibility`, use that instead of the `review` option.
4. **Superseded pending records** stay in the file, next to their harmonised readings. Each has its own `record_code`, and the lists show both today.
5. **`contested` / `n_contests`.** A contest counts while it is not withdrawn. It **flags** only while it is also unresolved (R-9, R-10). It applies to every record of the contested level (R-8), or to the one record for a quantitative contest. `n_contests` counts distinct contest authors, resolved contests included. `n_validations` counts distinct actors of `confirm` annotations.
6. **`annotations.csv` rows.** One row per `confirm` annotation on an exported record (kind `validation`, `reference` = the supporting reference). One row per exported contest record (kind `contest`): `record_code` is the contested record, `contest_record_code` the contest, `reference` the contest's references, and `date` the contest's `created_at`. A contest whose target was later withdrawn keeps its row and points at a code that is absent from `records.csv`.
7. **Names.** `users.name` is encrypted (RFC-40 R1). The raw cursor bypasses `encryptedText`, so `annotationsCsv` calls `getPii().decrypt(value, 'users.name')`. No query selects an e-mail address.
8. **Audit metadata and file name.** `{ format: 'zip', scope: 'dataset' }`, `application/zip`, `treerepro-dataset-<YYYY-MM-DD>.zip`, unless 13a fixed other values.
9. **RFC numbers.** Assumed as in Global Constraints (R8 = `annotations.csv`). Task 1 Step 2 reconciles them with 13a's text.
10. **ZIP64.** A ~2 GB `records.csv` is under the 4 GiB limit, so classic ZIP would do today. yazl writes ZIP64 by itself beyond that, so there is no flag to set and no 4 GiB test.
11. **Order.** `records.csv` follows RFC-66's existing order (family, genus nulls last, species, trait key) and then `record_code`. `annotations.csv` is ordered by `record_code`, then date.

## Risks

- **Query cost.** The `contests` CTE is materialised once. `n_validations` uses `record_annotations_record_idx`, `responds_to` uses the primary key. If contests grow into the tens of thousands, the per-row `CONTESTS_OF_R` scan becomes the bottleneck; an index on `(species_id, trait_id, level_id)` would fix it. Deferred, as the minimal diff.
- **Long downloads through Caddy.** A multi-minute stream depends on the proxy's timeouts, which this plan does not touch.
- **Unconsumed bodies in meta-tests** hold a cursor until teardown. See Task 5 Step 4 for the one-line remedy if that happens.
- **13e/13f/13g drift.** This plan rewrites `export.ts`, the route and their tests completely, so whatever names 13e used are overwritten. It relies only on the §6 column names and on the `resolve` kind existing in `ANNOTATION_KINDS`.

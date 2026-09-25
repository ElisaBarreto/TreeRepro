# Revision 13d — Book References (ISBN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A claim's sources can name a book by ISBN with its citation (spec R-16). `bibliographic_references` gains `isbn` (normalised ISBN-13, unique) and the kind `book`; the shared source input accepts `{ isbn, citation }` next to `{ id }` and `{ doi }`; the same ISBN given twice, as ISBN-10 or ISBN-13, is one reference; the entry form takes book rows that never wait on a DOI check; the references list and the reference page show the ISBN.

**Architecture:** `packages/contracts/src/isbn.ts` holds `isValidIsbn` (pure, no lookup). `sourceRefSchema` in `packages/contracts/src/curation.ts` gains a third member, so both `POST /api/records` (`sources.references[]`) and the confirmation's supporting reference accept a book with no route change. `apps/api/src/dataset/sources.ts` resolves `{ isbn, citation }` through a new `ensureBookReference` in `apps/api/src/dataset/references.ts`, which finds the book by ISBN or inserts it (`ON CONFLICT DO NOTHING`, audited). Column mapping: `citation_key = 'isbn:' || isbn`, `full_citation` = the citation, `short_citation` = the citation cut to 200 characters, `title` / `authors` / `year` / `journal` / `doi` / `url` null. The web `SourcesField` gets an **Add a book (ISBN)** button that appends a row with an ISBN field and a Citation field; DOI rows are unchanged.

**Tech Stack:** unchanged. No new dependencies.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` — R-16, §2 (entry dialog: "Sources accept a DOI, an ISBN with its citation, or neither"), §3 row 13d, §4 (collision on `packages/contracts/src/curation.ts`), §6 rows owned by 13d.

**Depends on:** 13a merged (RFC-61 / RFC-80 amended for R-16). Runs in wave 1 beside 13b, 13c, 13e, 13f. 13h depends on this plan.

## Global Constraints

- Branch `feat/13d-book-references` from `origin/main` after 13a merged, in worktree `../Elisa-13d`. Do not edit files outside the File Structure below.
- README rules: RFC first (13a already amended the RFCs), TDD (every step below writes the failing test first), no database mocks (API tests use testcontainers through `useTestDb`), every exported symbol in `apps/*/src` and `packages/*/src` carries `@rfc`, English everywhere.
- **RFC tags.** This plan tags ISBN code `@rfc RFC-61 R1` (the table's columns and kinds, as amended by 13a for spec R-16) and source resolution `@rfc RFC-80 R5`, the list default `@rfc RFC-61 R4` and the book edit guard `@rfc RFC-61 R6`, each "as amended by 13a". Task 0 checks the amended RFC-61; if 13a gave books a rule of their own, add it to every `@rfc RFC-61` tag and `describe('RFC-61 …')` title this plan introduces.
- **`packages/contracts/src/curation.ts` is shared with 13f (value schema) and 13g (annotations).** Touch only the sources block (`doiSchema` … `sourcesSchema`) and add one import line after `import { cursorQuerySchema } from './pagination.ts';`. Contract tests for sources go through `sourcesSchema` / `sourceRefSchema` / `annotateRecordBodySchema` directly, never through a `createRecordBodySchema` body, so 13f/13g's change of `value` cannot break them.
- **Shared fixtures.** `Reference` gains a required `isbn`. In the web suite, add `isbn: null` to the two base constants `REFERENCE` and `PERSONAL_OBSERVATION` in `apps/web/src/test/dataset-fixtures.ts` only; every other literal spreads them.
- **Migration number** `0035_book_references` is indicative: `db:generate` assigns it, and it is only safe at merge time (Task 8 re-checks and renumbers).
- **Verification runs in Docker** (no Node on this Mac). E2E is left to CI; this plan adds no E2E spec.

**Container (Task 0 creates it):**

```sh
docker run -d --name treerepro-13d -w /workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -e TESTCONTAINERS_RYUK_DISABLED=true \
  treerepro-verify:base sleep infinity
```

**Sync** (run from the worktree root before every command that runs in the container):

```sh
docker exec treerepro-13d sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-13d tar -x -C /workspace
```

Never `-delete` on that `find`: it disables `-prune` and wipes `node_modules`.

## File Structure

```
packages/contracts/src/isbn.ts                         # new: isValidIsbn
packages/contracts/src/isbn.test.ts                    # new
packages/contracts/src/index.ts                        # export * from './isbn.ts'
packages/contracts/src/dataset.ts                      # REFERENCE_KINDS gains 'book'; referenceSchema.isbn
packages/contracts/src/dataset.test.ts                 # reference fixture isbn; book kind
packages/contracts/src/curation.ts                     # sources block only: isbnSchema, bookCitationSchema, sourceRefSchema
packages/contracts/src/curation.test.ts                # resolve fixture isbn; book sources
apps/api/src/db/schema/references.ts                   # isbn column, checks, unique index
apps/api/drizzle/0035_book_references.sql              # generated
apps/api/drizzle/meta/0035_snapshot.json, _journal.json
apps/api/src/db/schema/dataset.integration.test.ts     # book constraints
apps/api/test/helpers/isbn.ts                          # new: randomIsbn
apps/api/src/dataset/references.ts                     # toReference.isbn; ensureBookReference; list default
apps/api/src/dataset/references.test.ts                # toReference carries isbn
apps/api/src/dataset/references.integration.test.ts    # list default; book edit guard
apps/api/src/dataset/sources.ts                        # { isbn, citation } source
apps/api/src/dataset/sources.integration.test.ts       # book sources
apps/api/src/dataset/catalog.ts                        # a book keeps its citation
apps/web/src/test/dataset-fixtures.ts                  # isbn: null on REFERENCE, PERSONAL_OBSERVATION
apps/web/src/components/curation/SourcesField.tsx      # book rows
apps/web/src/components/curation/SourcesField.test.tsx
apps/web/src/pages/dataset/ReferencesPage.tsx          # DOI / ISBN column
apps/web/src/pages/dataset/ReferencesPage.test.tsx
apps/web/src/pages/dataset/ReferencePage.tsx           # ISBN row for a book
apps/web/src/pages/dataset/ReferencePage.test.tsx
```

`DoiField.tsx` needs no change: book rows do not use it.

---

### Task 0: Pre-flight

**Files:** none.

- [ ] **Step 1: Claim the issue** (README rule 7): find the 13d issue with `gh issue list --search "13d book references"`, then `gh issue edit <n> --add-assignee @me --add-label in-progress`.
- [ ] **Step 2: Branch**

```sh
git fetch origin
git worktree add ../Elisa-13d -b feat/13d-book-references origin/main
cd ../Elisa-13d
```

- [ ] **Step 3: Confirm 13a is merged and read the amended rules**

```sh
grep -n "book\|isbn\|ISBN" docs/rfc/60-dataset/61-bibliographic-references.md docs/rfc/80-integrations/80-doi-resolution.md docs/rfc/70-workspace/70-contribution-workflow.md
```

Expected: RFC-61 names the kind `book` and the `isbn` column. If nothing matches, stop: 13a is not merged. If RFC-61 has a rule dedicated to books, note its number and add it to the tags (Global Constraints → RFC tags). If the amended RFC-61 R4 still says the list defaults to `publication` only, raise it with the owner before Task 5 (Spec notes, item 5).

- [ ] **Step 4: Container** — create it (Global Constraints → Container), Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm install --frozen-lockfile && pnpm --filter @treerepro/contracts build"
```

Expected: install finishes (fast, `node_modules` is baked in) and the build prints nothing.

---

### Task 1: `isValidIsbn`

**Files:** Create `packages/contracts/src/isbn.ts`, `packages/contracts/src/isbn.test.ts`; Modify `packages/contracts/src/index.ts`.

**Interfaces — Produces:** `export function isValidIsbn(input: string): string | null` (spec §6), re-exported from `@treerepro/contracts`.

- [ ] **Step 1: Failing test** — `packages/contracts/src/isbn.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isValidIsbn } from './isbn.ts';

describe('RFC-61 R1 isValidIsbn', () => {
  it('normalises an ISBN-13, with or without hyphens and spaces, to its 13 digits', () => {
    expect(isValidIsbn('9780306406157')).toBe('9780306406157');
    expect(isValidIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(isValidIsbn(' 978 0 306 40615 7 ')).toBe('9780306406157');
  });

  it('turns an ISBN-10 into the ISBN-13 of the same book, a final X included', () => {
    expect(isValidIsbn('0-306-40615-2')).toBe('9780306406157');
    expect(isValidIsbn('0-8044-2957-X')).toBe('9780804429573');
    expect(isValidIsbn('080442957x')).toBe('9780804429573');
  });

  it('refuses a wrong check digit, a non-book prefix, a misplaced X and any other length', () => {
    for (const bad of [
      '978-0-306-40615-8',
      '0-306-40615-3',
      '4006381333931',
      '97803064061X7',
      'X306406152',
      '030640615',
      '97803064061570',
      '',
      'ISBN 9780306406157',
      '10.1111/geb.13000',
    ]) {
      expect(isValidIsbn(bad)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project contracts packages/contracts/src/isbn.test.ts"
```

Expected: FAIL — `Failed to load url ./isbn.ts` (the module does not exist).

- [ ] **Step 3: Implement** — `packages/contracts/src/isbn.ts`:

```ts
// The ISBN-13 check digit of twelve digits: weights 1 and 3 alternating, the
// digit that brings the sum to a multiple of ten.
function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/**
 * An ISBN as typed — ISBN-10 or ISBN-13, hyphens and spaces allowed, a final
 * `X` (either case) standing for 10 in an ISBN-10 — normalised to its 13
 * digits, or `null` when it is not one: another length or character, a check
 * digit that does not match, or thirteen digits outside the 978/979 book
 * prefixes. An ISBN-10 becomes 978, its first nine digits and a new check
 * digit, so both forms of one book normalise alike. No lookup: a well-formed
 * ISBN is taken as given (RFC-61 R1).
 * @rfc RFC-61 R1
 */
export function isValidIsbn(input: string): string | null {
  const s = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) sum += (10 - i) * (s[i] === 'X' ? 10 : Number(s[i]));
    if (sum % 11 !== 0) return null;
    const first12 = `978${s.slice(0, 9)}`;
    return first12 + isbn13CheckDigit(first12);
  }
  if (/^97[89]\d{10}$/.test(s)) return isbn13CheckDigit(s.slice(0, 12)) === s[12] ? s : null;
  return null;
}
```

`packages/contracts/src/index.ts` — add between `health.ts` and `pagination.ts`:

```ts
export * from './isbn.ts';
```

- [ ] **Step 4: Run it** — same command as Step 2. Expected: PASS, 3 tests.
- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/isbn.ts packages/contracts/src/isbn.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): isValidIsbn normalises ISBN-10/13 to ISBN-13 (RFC-61 R1, plan 13d)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Schema — `isbn` column, kind `book`, migration

**Files:** Modify `packages/contracts/src/dataset.ts` (`REFERENCE_KINDS` only), `apps/api/src/db/schema/references.ts`, `apps/api/src/db/schema/dataset.integration.test.ts`; Create `apps/api/test/helpers/isbn.ts`, the generated migration.

**Interfaces — Consumes:** `isValidIsbn` (Task 1). **Produces:** `REFERENCE_KINDS = ['publication', 'book', 'personal_observation']`; column `bibliographic_references.isbn text` unique (spec §6), checks `bibliographic_references_book_check`, `bibliographic_references_isbn_check`; test helper `randomIsbn(): string`.

- [ ] **Step 1: Test helper** — `apps/api/test/helpers/isbn.ts`:

```ts
import { randomInt } from 'node:crypto';
import { isValidIsbn } from '@treerepro/contracts';

/**
 * A random, valid ISBN-13 with the 978 prefix, so tests sharing one database
 * never collide on the unique `isbn`.
 * @rfc RFC-61 R1
 */
export function randomIsbn(): string {
  const stem = `978${randomInt(0, 1_000_000_000).toString().padStart(9, '0')}`;
  for (let digit = 0; digit < 10; digit += 1) {
    const isbn = isValidIsbn(`${stem}${digit}`);
    if (isbn) return isbn;
  }
  throw new Error('randomIsbn: no check digit fits');
}
```

- [ ] **Step 2: Failing test** — in `apps/api/src/db/schema/dataset.integration.test.ts`, add the import `import { randomIsbn } from '../../../test/helpers/isbn.ts';` after the `users.ts` helper import, and add this `it` inside `describe('RFC-61 R1, R7 reference kinds', …)`, after the personal-observation test:

```ts
  it('RFC-61 R1 a book needs a 13-digit ISBN and a citation; an ISBN is unique and only a book has one', async () => {
    await withRollback(t.db, async (tx) => {
      const isbn = randomIsbn();
      const insert = (values: typeof bibliographicReferences.$inferInsert) =>
        unwrapDbError(tx.transaction((sp) => sp.insert(bibliographicReferences).values(values)));
      // A book without an ISBN, without a citation, or with an ISBN-10 left un-normalised.
      for (const values of [
        { citationKey: `b-${rand()}`, kind: 'book' as const, fullCitation: 'Doe (2001). Seeds.' },
        { citationKey: `b-${rand()}`, kind: 'book' as const, isbn },
        { citationKey: `b-${rand()}`, kind: 'book' as const, isbn: '030640615X', fullCitation: 'x' },
        // A publication carrying an ISBN.
        { citationKey: `b-${rand()}`, isbn, fullCitation: 'Doe (2001). Seeds.' },
      ]) {
        await expect(insert(values)).rejects.toMatchObject({ code: '23514' });
      }
      await tx.insert(bibliographicReferences).values({
        citationKey: `isbn:${isbn}`,
        kind: 'book',
        isbn,
        fullCitation: 'Doe (2001). Seeds.',
      });
      await expect(
        insert({ citationKey: `b-${rand()}`, kind: 'book', isbn, fullCitation: 'Other' }),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
```

- [ ] **Step 3: Run it** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm --filter @treerepro/contracts build && pnpm vitest run --project api:integration apps/api/src/db/schema/dataset.integration.test.ts -t 'a book needs'"
```

Expected: FAIL — the valid book insert raises `23514` from `bibliographic_references_kind_check` (`book` is not a kind yet; drizzle drops the unknown `isbn` key).

- [ ] **Step 4: Implement**

`packages/contracts/src/dataset.ts`:

```ts
/** @rfc RFC-61 R1, R7 */
export const REFERENCE_KINDS = ['publication', 'book', 'personal_observation'] as const;
```

`apps/api/src/db/schema/references.ts` — add to the doc comment above `bibliographicReferences`, before the `@rfc` line:

```ts
 * A `book` (RFC-61 R1) carries `isbn`, the normalised ISBN-13 of
 * `isValidIsbn`, unique, and its citation in `full_citation`; no other kind
 * has an ISBN. Both are enforced by the checks below, not only by the contract.
```

add the column after `fullCitation: text('full_citation'),`:

```ts
    isbn: text('isbn'),
```

replace the `bibliographic_references_kind_check` entry with:

```ts
    check(
      'bibliographic_references_kind_check',
      sql`${t.kind} in ('publication', 'book', 'personal_observation')`,
    ),
```

and append after `bibliographic_references_observer_idx`:

```ts
    uniqueIndex('bibliographic_references_isbn_idx').on(t.isbn),
    check(
      'bibliographic_references_book_check',
      sql`(${t.kind} = 'book') = (${t.isbn} is not null) and (${t.kind} <> 'book' or ${t.fullCitation} is not null)`,
    ),
    check('bibliographic_references_isbn_check', sql`${t.isbn} ~ '^97[89][0-9]{10}$'`),
```

- [ ] **Step 5: Generate the migration in the container and copy it out** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm --filter @treerepro/contracts build && pnpm --filter @treerepro/api db:generate --name book_references"
N=$(docker exec treerepro-13d sh -c "ls /workspace/apps/api/drizzle/ | grep _book_references.sql" | cut -d_ -f1)
docker cp "treerepro-13d:/workspace/apps/api/drizzle/${N}_book_references.sql" apps/api/drizzle/
docker cp "treerepro-13d:/workspace/apps/api/drizzle/meta/${N}_snapshot.json" apps/api/drizzle/meta/
docker cp treerepro-13d:/workspace/apps/api/drizzle/meta/_journal.json apps/api/drizzle/meta/
cat "apps/api/drizzle/${N}_book_references.sql"
```

Expected SQL (order may differ): `ALTER TABLE "bibliographic_references" ADD COLUMN "isbn" text;`, `DROP CONSTRAINT "bibliographic_references_kind_check"` then `ADD CONSTRAINT "bibliographic_references_kind_check" CHECK (… 'book' …)`, `CREATE UNIQUE INDEX "bibliographic_references_isbn_idx" …`, `ADD CONSTRAINT "bibliographic_references_book_check" …`, `ADD CONSTRAINT "bibliographic_references_isbn_check" …`. Existing rows satisfy every check (their `isbn` is null and their kind is not `book`). Then Sync and re-run the generate command; expected: `No schema changes, nothing to migrate`. Confirm `find apps/api/drizzle -name '._*'` prints nothing.

- [ ] **Step 6: Run it** — the Step 3 command. Expected: PASS. Then the whole schema file, to see the personal-observation test still passes:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project api:integration apps/api/src/db/schema/dataset.integration.test.ts"
```

- [ ] **Step 7: Commit**

```sh
git add packages/contracts/src/dataset.ts apps/api/src/db/schema/references.ts apps/api/src/db/schema/dataset.integration.test.ts apps/api/test/helpers/isbn.ts apps/api/drizzle
git commit -m "feat(api): book references — isbn column, book kind and checks (RFC-61 R1, plan 13d)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `Reference.isbn` in the contract and `toReference`

**Files:** Modify `packages/contracts/src/dataset.ts` (`referenceSchema`), `packages/contracts/src/dataset.test.ts`, `packages/contracts/src/curation.test.ts` (the `resolveDoiResultSchema` fixture only), `apps/api/src/dataset/references.ts` (`toReference`), `apps/api/src/dataset/references.test.ts`, `apps/web/src/test/dataset-fixtures.ts`.

**Interfaces — Produces:** `referenceSchema` (and so `referenceDetailSchema`, `Reference`, `ReferenceDetail`) gains `isbn: z.string().nullable()`; `toReference(row)` returns `isbn: row.isbn`. `referenceRefSchema` is unchanged.

- [ ] **Step 1: Failing tests**

`packages/contracts/src/dataset.test.ts` — in `describe('RFC-61 R4 referenceSchema', …)` add `isbn: null,` to the `reference` literal after `fullCitation: null,`, and add:

```ts
  it('RFC-61 R1 requires isbn, nullable, and knows the book kind', () => {
    const book = { ...reference, kind: 'book', isbn: '9780306406157' };
    expect(referenceSchema.parse(book)).toEqual(book);
    const { isbn: _i, ...withoutIsbn } = reference;
    expect(referenceSchema.safeParse(withoutIsbn).success).toBe(false);
    expect(
      referenceRefSchema.parse({
        id: uuid,
        citationKey: 'isbn:9780306406157',
        kind: 'book',
        observer: null,
        shortCitation: 'Doe (2001)',
      }).kind,
    ).toBe('book');
  });
```

`packages/contracts/src/curation.test.ts` — in the `resolveDoiResultSchema` `known` fixture add `isbn: null,` after `fullCitation: null,`.

`apps/api/src/dataset/references.test.ts` — add `isbn: null,` to `baseRow` after `fullCitation: null,`, and inside `describe('RFC-61 R1, R4 toReference', …)`:

```ts
  it('carries the ISBN of a book through', () => {
    const ref = toReference({ ...baseRow, kind: 'book', isbn: '9780306406157' });
    expect(ref).toMatchObject({ kind: 'book', isbn: '9780306406157' });
    expect(toReference(baseRow).isbn).toBeNull();
  });
```

- [ ] **Step 2: Run them** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project contracts packages/contracts/src/dataset.test.ts packages/contracts/src/curation.test.ts && pnpm vitest run --project api:unit apps/api/src/dataset/references.test.ts"
```

Expected: FAIL — `referenceSchema.parse(book)` throws `Unrecognized key: "isbn"`; the `known` fixture no longer parses; `toReference(...)` has no `isbn` (`expected undefined to be null`).

- [ ] **Step 3: Implement**

`packages/contracts/src/dataset.ts` — in `referenceSchema`, after `fullCitation: z.string().nullable(),`:

```ts
  isbn: z.string().nullable(),
```

and extend its doc comment with `` `isbn`: the normalised ISBN-13 of a `book`, null for every other kind. `` and its tag to `@rfc RFC-61 R1, R4`.

`apps/api/src/dataset/references.ts` — in `toReference`, after `fullCitation: row.fullCitation,`:

```ts
    isbn: row.isbn,
```

`apps/web/src/test/dataset-fixtures.ts` — add `isbn: null,` after `fullCitation: null,` in `REFERENCE` and in `PERSONAL_OBSERVATION` (nowhere else: every other reference literal spreads one of them).

- [ ] **Step 4: Run them** — the Step 2 command. Expected: PASS. Then typecheck, which proves no other `Reference` literal was missed:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm --filter @treerepro/contracts build && pnpm typecheck"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```sh
git add packages/contracts/src/dataset.ts packages/contracts/src/dataset.test.ts packages/contracts/src/curation.test.ts apps/api/src/dataset/references.ts apps/api/src/dataset/references.test.ts apps/web/src/test/dataset-fixtures.ts
git commit -m "feat(contracts): a reference carries its isbn (RFC-61 R1, plan 13d)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A book among the sources

**Files:** Modify `packages/contracts/src/curation.ts` (sources block + one import), `packages/contracts/src/curation.test.ts`, `apps/api/src/dataset/references.ts`, `apps/api/src/dataset/sources.ts`, `apps/api/src/dataset/sources.integration.test.ts`.

**Interfaces — Consumes:** `isValidIsbn`; `bibliographicReferences.isbn`. **Produces:**

```ts
// packages/contracts/src/curation.ts
export const isbnSchema = z.string().trim().min(10).max(20).refine((isbn) => isValidIsbn(isbn) !== null, …);
export const bookCitationSchema = z.string().trim().min(1).max(2000);
export const sourceRefSchema = z.union([{ id }, { doi }, { isbn, citation }]);
// sourcesSchema keeps its shape: { personalObservation: true } | { references: SourceRef[] (1–10) }
// apps/api/src/dataset/references.ts
export async function ensureBookReference(db: DbExecutor, input: { isbn: string; citation: string; actorId: string }): Promise<{ id: string }>;
// apps/api/src/dataset/sources.ts
export type SourceRefInput = { id: string } | { doi: string } | { isbn: string; citation: string };
```

- [ ] **Step 1: Failing contract test** — `packages/contracts/src/curation.test.ts`: add `sourceRefSchema, sourcesSchema,` to the import list from `./curation.ts` (alphabetical, after `setAcceptedBodySchema`), and append:

```ts
describe('RFC-61 R1, RFC-80 R5 a book among the sources', () => {
  const citation = 'Doe, J. (2001). Seeds of the tropics.';

  it('takes an ISBN-10 or ISBN-13 with its citation, beside a DOI', () => {
    expect(
      sourcesSchema.safeParse({
        references: [{ doi: '10.1111/geb.13000' }, { isbn: '0-306-40615-2', citation }],
      }).success,
    ).toBe(true);
    expect(sourceRefSchema.safeParse({ isbn: '978 0 306 40615 7', citation }).success).toBe(true);
  });

  it('refuses a bad check digit, a missing, blank or over-long citation, and a citation alone', () => {
    for (const source of [
      { isbn: '0-306-40615-3', citation },
      { isbn: '9780306406157' },
      { isbn: '9780306406157', citation: '   ' },
      { isbn: '9780306406157', citation: 'x'.repeat(2001) },
      { citation },
      { isbn: '9780306406157', citation, doi: '10.1111/geb.13000' },
    ]) {
      expect(sourceRefSchema.safeParse(source).success).toBe(false);
    }
  });

  it('a confirmation may name a book as its supporting reference', () => {
    expect(
      annotateRecordBodySchema.safeParse({
        kind: 'confirm',
        reference: { isbn: '9780306406157', citation },
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Failing API test** — `apps/api/src/dataset/sources.integration.test.ts`: add `import { randomIsbn } from '../../test/helpers/isbn.ts';` after the `doi.ts` helper import, change the `./sources.ts` import to `import { resolveDoi, resolveSourceRef, resolveSources } from './sources.ts';`, and add inside the `describe`:

```ts
  it('RFC-61 R1 a book is one reference per ISBN, whether given as ISBN-10 or ISBN-13', async () => {
    const { user } = await createUser(t.db);
    const ctx = { db: t.db, doi: fakeDoiClient() };
    const citation = 'Doe, J. (2001). Seeds of the tropics. Tropical Press.';
    // A fixed pair (the one book this file names by hand), so the ISBN-10
    // form can be written out; every other test uses randomIsbn().
    const [id] = await resolveSources(ctx, user.id, {
      references: [{ isbn: '0-306-40615-2', citation }],
    });
    const byId = eq(bibliographicReferences.id, id ?? '');
    const [row] = await t.db.select().from(bibliographicReferences).where(byId);
    expect(row).toMatchObject({
      kind: 'book',
      isbn: '9780306406157',
      citationKey: 'isbn:9780306406157',
      fullCitation: citation,
      shortCitation: citation,
      doi: null,
      title: null,
      createdBy: user.id,
    });
    // Again, as the ISBN-13 and with another citation: the same reference,
    // its citation untouched, no second audit entry.
    expect(
      await resolveSources(ctx, user.id, {
        references: [{ isbn: '978-0-306-40615-7', citation: 'Another text' }],
      }),
    ).toEqual([id]);
    const [again] = await t.db.select().from(bibliographicReferences).where(byId);
    expect(again?.fullCitation).toBe(citation);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.targetId, id ?? ''));
    expect(audits.map((a) => [a.action, a.metadata])).toEqual([
      ['references.created', { source: 'isbn' }],
    ]);
    // The confirmation's supporting reference goes through the same path.
    expect(
      await resolveSourceRef(ctx, user.id, { isbn: '9780306406157', citation }, 'reference'),
    ).toBe(id);
  });

  it('RFC-61 R1 cuts a long citation to 200 characters for the short citation only', async () => {
    const { user } = await createUser(t.db);
    const ctx = { db: t.db, doi: fakeDoiClient() };
    const citation = `${'Author, A.; '.repeat(25)}(2001). Seeds.`;
    const [id] = await resolveSources(ctx, user.id, {
      references: [{ isbn: randomIsbn(), citation }],
    });
    const [row] = await t.db
      .select()
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, id ?? ''));
    expect(row?.fullCitation).toBe(citation);
    expect(row?.shortCitation).toBe(`${citation.slice(0, 199)}…`);
    expect(row?.shortCitation).toHaveLength(200);
  });

  it('RFC-61 R1 refuses a malformed ISBN and counts one book given twice once', async () => {
    const { user } = await createUser(t.db);
    const ctx = { db: t.db, doi: fakeDoiClient() };
    await expect(
      resolveSources(ctx, user.id, { references: [{ isbn: '0-306-40615-3', citation: 'X' }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.0.isbn' }],
    });
    const isbn = randomIsbn();
    await expect(
      resolveSources(ctx, user.id, {
        references: [
          { isbn, citation: 'A' },
          { isbn, citation: 'A' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.1.isbn' }],
    });
  });
```

- [ ] **Step 3: Run them** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project contracts packages/contracts/src/curation.test.ts && pnpm vitest run --project api:integration apps/api/src/dataset/sources.integration.test.ts"
```

Expected: FAIL — the contract rejects `{ isbn, citation }` (no union member matches); the API tests throw `Malformed DOI` at path `sources.references.0.doi`, because `resolveSourceRef` treats every non-`id` source as a DOI.

- [ ] **Step 4: Implement the contract** — `packages/contracts/src/curation.ts`. Add after `import { cursorQuerySchema } from './pagination.ts';`:

```ts
import { isValidIsbn } from './isbn.ts';
```

Replace the `sourceRefSchema` block (its doc comment and declaration; `doiSchema` and `sourcesSchema` stay as they are) with:

```ts
/** An ISBN-10 or ISBN-13 as typed, hyphens and spaces allowed, with a valid check digit. @rfc RFC-61 R1 */
export const isbnSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .refine((isbn) => isValidIsbn(isbn) !== null, { message: 'Invalid ISBN' });
/** The citation a book is recorded under: authors, year, title. @rfc RFC-61 R1 */
export const bookCitationSchema = z.string().trim().min(1).max(2000);
/**
 * One source of a claim: a local reference, a DOI to resolve, or a book by
 * ISBN with its citation (never looked up).
 * @rfc RFC-80 R5
 * @rfc RFC-61 R1
 */
export const sourceRefSchema = z.union([
  z.strictObject({ id: z.uuid() }),
  z.strictObject({ doi: doiSchema }),
  z.strictObject({ isbn: isbnSchema, citation: bookCitationSchema }),
]);
```

- [ ] **Step 5: Implement `ensureBookReference`** — `apps/api/src/dataset/references.ts`, after `ensurePersonalObservation`:

```ts
/**
 * The `book` reference of a normalised ISBN-13, created on first use with
 * `citation` as its full citation and, cut to 200 characters, as its short
 * one; the citation key is `isbn:<isbn>`. A later use of the same ISBN
 * returns the existing reference and leaves its citation as it was. `ON
 * CONFLICT DO NOTHING` rather than a caught 23505, for the reason
 * {@link createReferenceFromDoi} gives.
 * @rfc RFC-61 R1
 * @rfc RFC-80 R5
 */
export async function ensureBookReference(
  db: DbExecutor,
  input: { isbn: string; citation: string; actorId: string },
): Promise<{ id: string }> {
  const readByIsbn = async (executor: DbExecutor) => {
    const [row] = await executor
      .select({ id: bibliographicReferences.id })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.isbn, input.isbn))
      .limit(1);
    return row;
  };

  const existing = await readByIsbn(db);
  if (existing) return existing;

  const shortCitation =
    input.citation.length <= 200 ? input.citation : `${input.citation.slice(0, 199)}…`;
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(bibliographicReferences)
      .values({
        citationKey: `isbn:${input.isbn}`,
        kind: 'book',
        isbn: input.isbn,
        fullCitation: input.citation,
        shortCitation,
        createdBy: input.actorId,
      })
      .onConflictDoNothing()
      .returning({ id: bibliographicReferences.id });
    if (inserted) {
      await recordAudit(tx, {
        actorUserId: input.actorId,
        action: 'references.created',
        targetType: 'bibliographic_references',
        targetId: inserted.id,
        metadata: { source: 'isbn' },
      });
      return inserted;
    }
    const raced = await readByIsbn(tx);
    if (!raced) throw new Error('ensureBookReference: reference not found after insert');
    return raced;
  });
}
```

- [ ] **Step 6: Implement the source** — `apps/api/src/dataset/sources.ts`:

Imports become:

```ts
import { isValidIsbn, type ResolveDoiResult } from '@treerepro/contracts';
```

and, from `./references.ts`, add `ensureBookReference` (between `createReferenceFromDoi` and `ensurePersonalObservation`).

```ts
export type SourceRefInput = { id: string } | { doi: string } | { isbn: string; citation: string };
```

In `resolveSourceRef`, change the doc comment's tags to `@rfc RFC-80 R5` and `@rfc RFC-61 R1`, and insert after the `if ('id' in source) { … }` block, before `const doi = normaliseDoi(source.doi);`:

```ts
  if ('isbn' in source) {
    const isbn = isValidIsbn(source.isbn);
    if (!isbn) throw validation(`${path}.isbn`, 'Invalid ISBN');
    const book = await ensureBookReference(ctx.db, {
      isbn,
      citation: source.citation.trim(),
      actorId,
    });
    return book.id;
  }
```

In `resolveSources`, replace the duplicate throw with:

```ts
    if (seen.has(id)) {
      const field = 'id' in source ? 'id' : 'isbn' in source ? 'isbn' : 'doi';
      throw validation(`${p}.${field}`, 'Duplicate reference');
    }
```

- [ ] **Step 7: Run them** — Sync, then the Step 3 command with the contracts build first:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm --filter @treerepro/contracts build && pnpm vitest run --project contracts packages/contracts/src/curation.test.ts && pnpm vitest run --project api:integration apps/api/src/dataset/sources.integration.test.ts apps/api/src/http/routes/dataset/records.integration.test.ts"
```

Expected: PASS (the records route suite is included to show `POST /api/records` and the annotations route still take the DOI and id shapes unchanged).

- [ ] **Step 8: Commit**

```sh
git add packages/contracts/src/curation.ts packages/contracts/src/curation.test.ts apps/api/src/dataset/references.ts apps/api/src/dataset/sources.ts apps/api/src/dataset/sources.integration.test.ts
git commit -m "feat(api): a claim's source may be a book by ISBN with its citation (RFC-61 R1, RFC-80 R5, plan 13d)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Books in the references list; a book keeps its citation

**Files:** Modify `apps/api/src/dataset/references.ts` (`searchReferences`), `apps/api/src/dataset/catalog.ts` (`updateReference`), `apps/api/src/dataset/references.integration.test.ts`.

**Interfaces — Produces:** `GET /api/references` with no `kind` returns every kind except `personal_observation` (was: `publication` only); `kind=book` filters books. `PATCH /api/references/:id` answers 400 `VALIDATION_FAILED` (path `fullCitation`) when it would clear a book's citation.

- [ ] **Step 1: Failing tests** — `apps/api/src/dataset/references.integration.test.ts`: add `import { randomIsbn } from '../../test/helpers/isbn.ts';` after the `users.ts` helper import, add `ensureBookReference,` to the `./references.ts` import (after `createReferenceFromDoi`), and add inside `describe('RFC-61 R4 references', …)`, after the personal-observation search test:

```ts
  it('RFC-61 R4 the default list holds publications and books, never personal observations', async () => {
    const { user } = await createUser(t.db);
    const k = tag();
    const book = await ensureBookReference(t.db, {
      isbn: randomIsbn(),
      citation: `Doe (2001). Book ${k}.`,
      actorId: user.id,
    });
    const pub = await createReference(t.db, { citationKey: `Pub_${k}` });

    const byDefault = await searchReferences(t.db, UNRESTRICTED, { q: k, limit: 10 });
    expect(byDefault.data.map((r) => r.id).sort()).toEqual([book.id, pub.id].sort());
    expect(byDefault.data.find((r) => r.id === book.id)).toMatchObject({
      kind: 'book',
      isbn: expect.stringMatching(/^97[89]\d{10}$/),
    });
    const books = await searchReferences(t.db, UNRESTRICTED, { q: k, limit: 10, kind: 'book' });
    expect(books.data.map((r) => r.id)).toEqual([book.id]);
    const pubs = await searchReferences(t.db, UNRESTRICTED, {
      q: k,
      limit: 10,
      kind: 'publication',
    });
    expect(pubs.data.map((r) => r.id)).toEqual([pub.id]);
  });

  it('RFC-61 R6 a book keeps its citation: clearing it is refused, rewriting it is not', async () => {
    const { user } = await createUser(t.db);
    const book = await ensureBookReference(t.db, {
      isbn: randomIsbn(),
      citation: 'Doe (2001). Seeds.',
      actorId: user.id,
    });
    await expect(
      updateReference(t.db, { id: book.id, fullCitation: null, actorId: user.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'fullCitation' }] });
    const updated = await updateReference(t.db, {
      id: book.id,
      fullCitation: 'Doe (2002). Seeds, second edition.',
      actorId: user.id,
    });
    expect(updated.fullCitation).toBe('Doe (2002). Seeds, second edition.');
  });
```

- [ ] **Step 2: Run them** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project api:integration apps/api/src/dataset/references.integration.test.ts"
```

Expected: FAIL — the default list returns only the publication (`expected [ pub ] to equal [ book, pub ]`); clearing the book's citation raises a raw `23514` (`bibliographic_references_book_check`) instead of `VALIDATION_FAILED`.

- [ ] **Step 3: Implement**

`apps/api/src/dataset/references.ts` — add `ne` to the `drizzle-orm` import (`and, asc, count, desc, eq, ilike, ne, or, type SQL, sql`), add `@rfc RFC-61 R1` beside the existing tags on `searchReferences`, and replace the kind block:

```ts
  // No `kind` means every kind but personal observations: an observation
  // belongs to its observer and is never offered as a source to pick from
  // (RFC-61 R7); publications and books are (RFC-61 R4).
  if (input.kind === undefined) {
    conditions.push(ne(bibliographicReferences.kind, 'personal_observation'));
  } else if (input.kind !== 'all') {
    conditions.push(eq(bibliographicReferences.kind, input.kind));
  }
```

`apps/api/src/dataset/catalog.ts` — in `updateReference`, after the `REFERENCE_IS_PERSONAL` check:

```ts
    // A book is recorded under its citation (RFC-61 R1); the check
    // `bibliographic_references_book_check` would refuse the update anyway.
    if (current.kind === 'book' && input.fullCitation === null) {
      throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
        { path: 'fullCitation', message: 'A book needs its citation' },
      ]);
    }
```

and change its tag to `/** \`null\` clears a metadata field; \`citationKey\` is never null. @rfc RFC-61 R1, R6 */`.

- [ ] **Step 4: Run them** — the Step 2 command, then the reference route suite:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project api:integration apps/api/src/dataset/references.integration.test.ts apps/api/src/http/routes/dataset/references.integration.test.ts apps/api/src/dataset/catalog.integration.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/api/src/dataset/references.ts apps/api/src/dataset/catalog.ts apps/api/src/dataset/references.integration.test.ts
git commit -m "feat(api): books in the references list; a book keeps its citation (RFC-61 R4, R6, plan 13d)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Book rows in the sources field

**Files:** Modify `apps/web/src/components/curation/SourcesField.tsx`, `apps/web/src/components/curation/SourcesField.test.tsx`.

**Interfaces — Consumes:** `isValidIsbn`, `CreateRecordBody['sources']` with the book member. **Produces:**

```ts
export type BookSource = { isbn: string; citation: string };
export type SourcesValue = { dois: string[]; books?: BookSource[] };   // `books` optional: callers' `{ dois: [''] }` still compiles
export function sourcesToBody(value: SourcesValue): CreateRecordBody['sources'];   // DOIs first, then filled books
```

`AddEntriesDialog` and `ContestDialog` need no change: they hold `SourcesValue` in state and pass it through.

- [ ] **Step 1: Failing tests** — `apps/web/src/components/curation/SourcesField.test.tsx`: append inside `describe('RFC-70 R1 SourcesField', …)`:

```ts
  it('RFC-61 R1 takes a book by ISBN and citation, with no DOI check', async () => {
    const { onValidity } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Add a book (ISBN)' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'ISBN' }), '0-306-40615-2');
    expect(onValidity).toHaveBeenLastCalledWith(false);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Citation' }),
      'Doe, J. (2001). Seeds of the tropics.',
    );
    await userEvent.tab();
    await waitFor(() => expect(onValidity).toHaveBeenLastCalledWith(true));
    expect(curation.resolveDoi).not.toHaveBeenCalled();
    expect(
      screen.queryByText('This will be recorded as your personal observation'),
    ).not.toBeInTheDocument();
  });

  it('RFC-61 R1 blocks a book with a bad ISBN or no citation, and says why once the ISBN is left', async () => {
    const { onValidity } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Add a book (ISBN)' }));
    const isbn = screen.getByRole('textbox', { name: 'ISBN' });
    await userEvent.type(isbn, '0-306-40615-3');
    expect(screen.queryByText('Not a valid ISBN')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByText('Not a valid ISBN')).toBeInTheDocument();
    expect(screen.getByText('Give the citation of the book')).toBeInTheDocument();
    expect(onValidity).toHaveBeenLastCalledWith(false);
    await userEvent.clear(isbn);
    await userEvent.type(isbn, '978-0-306-40615-7');
    expect(screen.queryByText('Not a valid ISBN')).not.toBeInTheDocument();
    expect(onValidity).toHaveBeenLastCalledWith(false);
  });

  it('RFC-61 R1 counts book rows toward the ten and removes them again', async () => {
    mount();
    // 1 DOI row + 7 more + 2 books = the ten rows the field allows.
    for (let i = 0; i < 7; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Add another reference' }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Add a book (ISBN)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a book (ISBN)' }));
    expect(screen.getByRole('textbox', { name: 'ISBN 2' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Citation 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a book (ISBN)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add another reference' })).not.toBeInTheDocument();
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(removes[removes.length - 1] as HTMLElement);
    expect(screen.queryByRole('textbox', { name: 'ISBN 2' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a book (ISBN)' })).toBeInTheDocument();
  });

  it('shows the API error of a book under its field', async () => {
    mount({ 'sources.references.0.citation': 'Citation is too long.' });
    await userEvent.click(screen.getByRole('button', { name: 'Add a book (ISBN)' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'ISBN' }), '9780306406157');
    expect(screen.getByRole('textbox', { name: 'Citation' })).toHaveAccessibleDescription(
      'Authors, year, title Citation is too long.',
    );
  });
```

and append inside `describe('RFC-70 R1 sourcesToBody', …)`:

```ts
  it('RFC-61 R1 sends the books after the DOIs, trimmed, and drops blank book rows', () => {
    expect(
      sourcesToBody({
        dois: ['10.1/x', ''],
        books: [
          { isbn: ' 0-306-40615-2 ', citation: ' Doe (2001). Seeds. ' },
          { isbn: '', citation: '  ' },
        ],
      }),
    ).toEqual({
      references: [{ doi: '10.1/x' }, { isbn: '0-306-40615-2', citation: 'Doe (2001). Seeds.' }],
    });
    expect(sourcesToBody({ dois: [''], books: [{ isbn: '', citation: '' }] })).toEqual({
      personalObservation: true,
    });
  });
```

- [ ] **Step 2: Run them** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm --filter @treerepro/contracts build && pnpm vitest run --project web apps/web/src/components/curation/SourcesField.test.tsx"
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Add a book (ISBN)"`; `sourcesToBody` ignores `books`.

- [ ] **Step 3: Implement** — `apps/web/src/components/curation/SourcesField.tsx`.

Imports:

```ts
import { type CreateRecordBody, isValidIsbn, type ResolveDoiResult } from '@treerepro/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { resolveDoi } from '../../api/curation.ts';
import { helpHref } from '../../content/help/href.ts';
import { Button, Field, HelpTip, Input } from '../ui/index.ts';
import { type DoiCheck, DoiField, resolvedCheck } from './DoiField.tsx';
```

Replace the `SourcesValue` type with:

```ts
/** A book among a claim's sources: its ISBN as typed and the citation it is recorded under. */
export type BookSource = { isbn: string; citation: string };

/**
 * The sources of a claim: the DOIs, one per row (`''` rows are blank ones),
 * and after them the books given by ISBN — absent until one is added.
 */
export type SourcesValue = { dois: string[]; books?: BookSource[] };
```

After `const HINT = …;` add:

```ts
const bookFilled = (book: BookSource) => book.isbn.trim() !== '' || book.citation.trim() !== '';
// A book is never looked up (RFC-61 R1): ready once its ISBN is well-formed
// and it has a citation, or while the row is blank.
const bookReady = (book: BookSource) =>
  !bookFilled(book) || (isValidIsbn(book.isbn) !== null && book.citation.trim() !== '');
```

Replace `sourcesToBody` (keep its doc comment, add ` The books follow the DOIs, trimmed; a blank book row is dropped.` and the tag `@rfc RFC-61 R1`):

```ts
export function sourcesToBody(value: SourcesValue): CreateRecordBody['sources'] {
  const dois = value.dois.map((doi) => doi.trim()).filter((doi) => doi !== '');
  const books = (value.books ?? [])
    .filter(bookFilled)
    .map((book) => ({ isbn: book.isbn.trim(), citation: book.citation.trim() }));
  return dois.length === 0 && books.length === 0
    ? { personalObservation: true }
    : { references: [...dois.map((doi) => ({ doi })), ...books] };
}
```

Add, before `SourcesField`:

```tsx
/**
 * One book among the sources: its ISBN and its citation. The ISBN is checked
 * here only to say what is wrong once the field is left; the API checks both
 * again (RFC-61 R1). A book is never looked up, so it never waits on a check.
 */
function BookRow({
  id,
  number,
  value,
  onChange,
  onRemove,
  errors,
}: {
  id: string;
  number: number;
  value: BookSource;
  onChange(v: BookSource): void;
  onRemove(): void;
  errors: { isbn?: string; citation?: string };
}) {
  const [left, setLeft] = useState(false);
  const isbnGiven = value.isbn.trim() !== '';
  const isbnError =
    left && isbnGiven && isValidIsbn(value.isbn) === null ? 'Not a valid ISBN' : errors.isbn;
  const citationError =
    errors.citation ??
    (left && isbnGiven && value.citation.trim() === '' ? 'Give the citation of the book' : undefined);
  const suffix = number === 1 ? '' : ` ${number}`;
  return (
    <div className="flex flex-col gap-2">
      <Field
        id={`${id}-isbn`}
        label={`ISBN${suffix}`}
        hint="ISBN-10 or ISBN-13"
        error={isbnError}
        trailing={
          <Button variant="secondary" size="sm" onClick={onRemove}>
            Remove
          </Button>
        }
      >
        <Input
          id={`${id}-isbn`}
          value={value.isbn}
          maxLength={20}
          placeholder="978-0-306-40615-7"
          onChange={(e) => onChange({ ...value, isbn: e.target.value })}
          onBlur={() => setLeft(true)}
          invalid={Boolean(isbnError)}
        />
      </Field>
      <Field
        id={`${id}-citation`}
        label={`Citation${suffix}`}
        hint="Authors, year, title"
        error={citationError}
      >
        <Input
          id={`${id}-citation`}
          value={value.citation}
          maxLength={2000}
          onChange={(e) => onChange({ ...value, citation: e.target.value })}
          invalid={Boolean(citationError)}
        />
      </Field>
    </div>
  );
}
```

In `SourcesField`:
1. Extend its doc comment with: ` **Add a book (ISBN)** appends a row with an ISBN and a Citation field after the DOI rows; a book is never checked against the registry, so it is ready once its ISBN is well-formed and it has a citation. DOI and book rows share the limit of ten.` and add `@rfc RFC-61 R1`.
2. After `const dois = rows.map((doi) => doi.trim());` add `const books = value.books ?? [];`.
3. Replace the `ready` line with:

```ts
  const ready =
    dois.every((doi) => doi === '' || checks.get(doi)?.status === 'ok') && books.every(bookReady);
```

4. After `rowError`, add:

```ts
  // Books follow the filled DOIs in the body `sourcesToBody` sends, so a
  // book's path counts every filled DOI and the filled books before it.
  function bookErrors(index: number): { isbn?: string; citation?: string } {
    const book = books[index];
    if (book === undefined || !bookFilled(book)) return {};
    const position =
      dois.filter((doi) => doi !== '').length + books.slice(0, index).filter(bookFilled).length;
    const path = `sources.references.${position}`;
    return { isbn: errors[`${path}.isbn`] ?? errors[path], citation: errors[`${path}.citation`] };
  }
```

5. In the DOI rows, every `onChange({ dois: … })` becomes `onChange({ ...value, dois: … })` (the row's `onChange`, its `onRemove`, and the add button), so a DOI edit keeps the books.
6. After the DOI rows' `.map(…)`, inside the same `<div className="flex flex-col gap-4">`, add:

```tsx
        {books.map((book, index) => {
          const rowId = `${baseId}-book-${index}`;
          return (
            <BookRow
              key={rowId}
              id={rowId}
              number={index + 1}
              value={book}
              onChange={(next) =>
                onChange({ ...value, books: books.map((b, i) => (i === index ? next : b)) })
              }
              onRemove={() => onChange({ ...value, books: books.filter((_, i) => i !== index) })}
              errors={bookErrors(index)}
            />
          );
        })}
```

7. Replace the add-button block and the personal-observation line with:

```tsx
      {rows.length + books.length < MAX_ROWS ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange({ ...value, dois: [...rows, ''] })}
          >
            Add another reference
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange({ ...value, books: [...books, { isbn: '', citation: '' }] })}
          >
            Add a book (ISBN)
          </Button>
        </div>
      ) : null}
      {dois.every((doi) => doi === '') && !books.some(bookFilled) ? (
        <p className="text-meta text-mist-500">
          This will be recorded as your personal observation
        </p>
      ) : null}
```

- [ ] **Step 4: Run them** — the Step 2 command, then the two dialogs that embed the field:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project web apps/web/src/components/curation/"
```

Expected: PASS, the existing SourcesField, AddEntriesDialog and ContestDialog tests included (DOI labels and the hint are unchanged).

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/curation/SourcesField.tsx apps/web/src/components/curation/SourcesField.test.tsx
git commit -m "feat(web): add a book by ISBN and citation among a claim's sources (RFC-61 R1, plan 13d)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The ISBN on the references pages

**Files:** Modify `apps/web/src/pages/dataset/ReferencesPage.tsx`, `ReferencesPage.test.tsx`, `ReferencePage.tsx`, `ReferencePage.test.tsx`.

**Interfaces — Consumes:** `Reference.isbn`, `ReferenceDetail.isbn`. **Produces:** the list's last column reads **DOI / ISBN** and shows `ISBN <13 digits>` for a book; the reference page adds an **ISBN** row for a book only.

- [ ] **Step 1: Failing tests**

`apps/web/src/pages/dataset/ReferencesPage.test.tsx` — change the header expectation to `['Article', 'As primary', 'As secondary', 'Year', 'DOI / ISBN']`, and add inside `describe('RFC-13 R2, RFC-61 R4 ReferencesPage', …)`:

```ts
  it('RFC-61 R1 shows a book by its citation, with its ISBN in the DOI / ISBN column', async () => {
    const book: Reference = {
      ...REFERENCE,
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f05',
      citationKey: 'isbn:9780306406157',
      kind: 'book',
      isbn: '9780306406157',
      title: null,
      doi: null,
      url: null,
      shortCitation: 'Doe, J. (2001). Seeds of the tropics.',
      fullCitation: 'Doe, J. (2001). Seeds of the tropics.',
    };
    dataset.searchReferences.mockResolvedValue(page([book]));
    await openPage();
    const link = await screen.findByRole('link', { name: 'Doe, J. (2001). Seeds of the tropics.' });
    const row = cells(link.closest('tr') as HTMLElement);
    expect(row[4]).toHaveTextContent(/^ISBN 9780306406157$/);
    expect(within(row[4] as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });
```

`apps/web/src/pages/dataset/ReferencePage.test.tsx` — add inside `describe('RFC-61 R4 ReferencePage metadata', …)`:

```ts
  it('RFC-61 R1 shows the ISBN of a book, and no ISBN row for anything else', async () => {
    const book: ReferenceDetail = {
      ...REFERENCE_DETAIL,
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f05',
      citationKey: 'isbn:9780306406157',
      kind: 'book',
      isbn: '9780306406157',
      title: null,
      authors: null,
      year: null,
      journal: null,
      doi: null,
      url: null,
      shortCitation: 'Doe (2001)',
      fullCitation: 'Doe, J. (2001). Seeds of the tropics.',
    };
    dataset.fetchReference.mockResolvedValue(book);
    renderAt(`/app/references/${book.id}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Doe (2001)' }),
    ).toBeInTheDocument();
    expect(definition('ISBN')).toHaveTextContent(/^9780306406157$/);
    expect(screen.getByText('Doe, J. (2001). Seeds of the tropics.')).toBeInTheDocument();
  });

  it('RFC-61 R1 a publication has no ISBN row', async () => {
    await openPage();
    expect(screen.queryByText('ISBN', { selector: 'dt' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm vitest run --project web apps/web/src/pages/dataset/ReferencesPage.test.tsx apps/web/src/pages/dataset/ReferencePage.test.tsx"
```

Expected: FAIL — the header still reads `DOI`; the book's cell reads `—`; `definition('ISBN')` throws (`Unable to find an element with the text: ISBN`).

- [ ] **Step 3: Implement**

`apps/web/src/pages/dataset/ReferencesPage.tsx` — header `<Th>DOI / ISBN</Th>`, and the last cell:

```tsx
              <Td className="break-all">
                {reference.doi ? (
                  <a
                    href={doiHref(reference.doi)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                  >
                    {reference.doi}
                  </a>
                ) : reference.isbn ? (
                  `ISBN ${reference.isbn}`
                ) : (
                  DASH
                )}
              </Td>
```

`apps/web/src/pages/dataset/ReferencePage.tsx` — in `metadataRows`, after the `DOI` entry:

```ts
    // A book only (RFC-61 R1): every other reference would read "—" here.
    ...(reference.isbn ? [{ label: 'ISBN', value: reference.isbn }] : []),
```

- [ ] **Step 4: Run them** — the Step 2 command. Expected: PASS. Then check the E2E suite asserts nothing on the renamed header:

```sh
grep -rn "'DOI'" apps/e2e/tests
```

Expected: only `references.spec.ts` on the reference page's `dt:text-is("DOI")`, which is unchanged.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/pages/dataset/ReferencesPage.tsx apps/web/src/pages/dataset/ReferencesPage.test.tsx apps/web/src/pages/dataset/ReferencePage.tsx apps/web/src/pages/dataset/ReferencePage.test.tsx
git commit -m "feat(web): show a book's ISBN on the references list and page (RFC-61 R1, plan 13d)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Full pipeline, rebase, migration number, PR

**Files:** possibly `apps/api/drizzle/*` (renumbering only).

- [ ] **Step 1: Full pipeline on the branch** — Sync, then:

```sh
docker exec treerepro-13d sh -c "cd /workspace && pnpm lint && pnpm typecheck && pnpm rfc:check && pnpm build && pnpm test"
```

Expected: all green. `pnpm lint:fix` changes container files only; apply every Biome finding in the worktree and re-run.

- [ ] **Step 2: Rebase onto the current `main`** (rebase, never merge):

```sh
git fetch origin
git rebase origin/main
ls apps/api/drizzle/*.sql | tail -4
```

If another branch (13e, 13f, 13g) took the number of `*_book_references.sql`, renumber: rename the `.sql` and `meta/NNNN_snapshot.json` to the next free number, fix the `_journal.json` entry's `idx` and `tag`, re-chain the snapshot's `prevId` to the new predecessor's `id`, and copy into this snapshot every object the upstream migration added (snapshots are full state). Then Sync and run `pnpm --filter @treerepro/contracts build && pnpm --filter @treerepro/api db:generate` in the container; expected: `No schema changes, nothing to migrate`.

- [ ] **Step 3: Full pipeline on the rebased tree** — Step 1's command again. Also grep what a sibling may have changed under this plan's feet: `grep -rn "sourceRefSchema\|SourcesValue\|REFERENCE_KINDS" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules` and read each new call site.
- [ ] **Step 4: Review** — CodeRabbit CLI on the branch (`coderabbit:code-review`), fix, re-run Step 1.
- [ ] **Step 5: Push and open the PR**

```sh
git -c http.version=HTTP/1.1 push -u origin feat/13d-book-references
gh pr create --title "feat: book references by ISBN (plan 13d)" --body "$(cat <<'EOF'
Implements spec R-16 (docs/specs/2026-09-25-record-model-revision-design.md, plan 13d): `bibliographic_references.isbn` and the `book` kind; `isValidIsbn` in contracts; `{ isbn, citation }` as a source of a record or a confirmation; book rows in the sources field; the ISBN on the references list and page. The default reference list now includes books (RFC-61 R4 as amended by 13a).

Closes #<13d issue>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After merge: `gh issue edit <n> --remove-label in-progress`.

---

## Spec notes

1. **Source input shape.** §6 writes the source input as `{ personalObservation: true } | Array<…>`. The contract today wraps the array as `{ references: […] }` (RFC-70 R1), and `AddEntriesDialog`, `ContestDialog`, the API routes and their tests all use that wrapper. This plan keeps the wrapper and reads §6 as describing the *elements*: `{ id } | { doi } | { isbn, citation }`, 1–10. If the owner meant a bare array, §6 needs an amendment and every call site changes.
2. **Column mapping.** A book is `kind = 'book'`, `isbn` (ISBN-13), `citation_key = 'isbn:<isbn>'` (like `doi:<doi>`), `full_citation` = the citation, `short_citation` = the citation cut to 200 characters (199 + `…`, the RFC-61 R1 limit), and `title`/`authors`/`year`/`journal`/`doi`/`url` null. The citation is 1–2,000 characters (the `fullCitation` limit of RFC-61 R6). When the ISBN is already known, the existing reference is used and the new citation is ignored.
3. **Stricter ISBN-13.** Beyond "13 digits" (§6), a 13-digit ISBN must start with 978 or 979, since other EAN-13 prefixes are not books. The DB check is `^97[89][0-9]{10}$`.
4. **Existing rules this plan cites.** It tags RFC-61 R1 (and R4, R6) and RFC-80 R5 "as amended by 13a for spec R-16". Task 0 adds a dedicated book rule to the tags if 13a created one.
5. **The references list default changes (needs 13a coverage).** RFC-61 R4 says `GET /api/references` with no `kind` returns publications only. Left as is, books would never appear on ReferencesPage, which R-16 requires. The plan changes the default to "every kind except `personal_observation`". **13a's amendment of RFC-61 R4 must say this.** Task 0 Step 3 checks it.
6. **A book keeps its citation.** `PATCH /api/references/:id` clearing a book's `fullCitation` answers 400 instead of hitting the DB check (a 500). Other edits of a book are allowed, and a curator cannot create a book through `POST /api/references`: books come only from sources.
7. **UI choice.** Books get their own rows, added with a separate **Add a book (ISBN)** button, rather than being detected from ISBN-shaped input in the DOI field. The DOI rows, their labels and the hint are unchanged, so no existing test changes. The hint still reads "…otherwise give the DOI"; 13h/13j can reword it. Book rows are never resolved, so they never block on a DOI check.
8. **Validation with an ISBN.** `annotateRecordBodySchema.reference` accepts a book today, through the shared `sourceRefSchema`. 13g renames the field to `referenceSource`, and the validate dialog's UI (`RecordActions`, still DOI-only) is 13g/13h's job.
9. **Export.** `export.ts` prints `citation_key` for a non-personal reference, so a book reads `isbn:978…` in the interim CSV. The full export's `references` column is 13i's.
10. **No route-level test.** `POST /api/records` passes `sources` through unchanged, so the book path is proven by the contract tests and `sources.integration.test.ts`. A route test would carry a `value` body that 13f/13g are about to reshape.
11. **Migration** `0035_book_references` is indicative. It is renumbered at merge time (Task 8).

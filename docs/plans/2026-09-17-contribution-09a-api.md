# Contribution 09a — API: Personal Observations, DOI Resolution, Multi-Reference Records, Intent, Reviewer Permission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** The API side of the contributor workflow: references of kind `personal_observation`; a DOI client over the Handle and Crossref APIs with `GET /api/references/resolve`; `POST /api/records` taking several sources and creating one record per reference with an optional `intent` / `respondsToRecordId` (a contest inserts a generated `dispute`; withdrawing it inserts a generated `neutral`); `confirm` with a supporting reference; the `records.review` permission gating `neutral` and `dispute`; `includeMissing` on the species trait summary.

**Architecture:** `apps/api/src/integrations/doi.ts` holds `normaliseDoi`, the `DoiClient` interface and `createDoiClient(fetch)`; `ctx.doi` is injected by `createApp` (a fake in tests). `apps/api/src/dataset/sources.ts` resolves `[{ id } | { doi }] | { personalObservation }` to reference ids, creating references outside the record transaction. `curation.ts` grows `createRecords` (plural) and the contest/withdraw side effects, all inserts into the append-only tables.

**Tech Stack:** unchanged; `fast-check` (already a dev dependency) for the DOI normalisation property test. No new dependencies.

**Spec:** `docs/specs/2026-09-17-contribution-design.md` (§2–§6, §8) and `docs/specs/2026-09-17-contributor-launch-overview.md`. Depends on plans 08a and 08b merged (visibility parameters exist on every service).

## Global Constraints

Same as plan 08a. Branch `feat/contribution-09a` in worktree `../Elisa-09a`. New environment variable `DOI_CONTACT_EMAIL` (optional) read by `config.ts`; the E2E Compose file and `.env.example` document it. Tests never reach the network: `useTestApp` injects `fakeDoiClient()`.

## File structure (end state)

```
docs/rfc/70-workspace/70-contribution-workflow.md           # new
docs/rfc/80-integrations/80-doi-resolution.md               # new
docs/rfc/README.md                                          # categories 70–79, 80–89; rows
docs/rfc/10-platform/12-error-codes.md                      # DOI_LOOKUP_FAILED, REFERENCE_IS_PERSONAL
docs/rfc/30-access/30-permission-catalog.md                 # records.review
docs/rfc/30-access/31-roles.md                              # R10 manager += records.review
docs/rfc/60-dataset/61-bibliographic-references.md          # R1, R4 amended; R7, R8 new
docs/rfc/60-dataset/63-trait-records.md                     # R1, R2, R7, R8, R10 amended
docs/rfc/60-dataset/65-curation.md                          # R1–R4 amended
docs/rfc/60-dataset/66-dataset-export.md                    # personal observation label
apps/api/drizzle/0020_permissions_review.sql                # custom
apps/api/drizzle/0021_contribution.sql                      # generated + trigger
apps/api/src/db/schema/references.ts, records.ts, curation.ts
apps/api/src/config.ts                                      # doiContactEmail
apps/api/src/integrations/doi.ts (+ .test.ts, .property.test.ts)
apps/api/src/integrations/http.ts                           # fetchJsonFixedHost (shared with plan 12c)
apps/api/src/auth/context.ts, app.ts, server.ts             # ctx.doi
apps/api/test/helpers/doi.ts                                # fakeDoiClient
apps/api/src/dataset/references.ts                          # kind, observer, ensurePersonalObservation, findByDoi, createFromDoi
apps/api/src/dataset/sources.ts (+ .integration.test.ts)    # resolveSources
apps/api/src/dataset/curation.ts (+ .integration.test.ts)   # createRecords, annotate review gate, side effects
apps/api/src/dataset/records.ts                             # intent, respondsTo, responses, annotation.reference/generated
apps/api/src/dataset/summary.ts                             # includeMissing
apps/api/src/dataset/export.ts                              # Personal observation label
apps/api/src/http/routes/dataset/references.ts              # GET /resolve; kind filter
apps/api/src/http/routes/dataset/records.ts                 # POST / new body; annotations gate
apps/api/src/http/routes/dataset/species.ts                 # includeMissing
packages/contracts/src/dataset.ts, curation.ts, permissions.ts, error-codes.ts, references? (in dataset.ts)
apps/web/src/test/dataset-fixtures.ts                       # schema changes (web tests must still pass)
```

---

### Task 1: RFC-70, RFC-80 and the amendments

- [ ] **Step 1: `docs/rfc/README.md`** — add ranges `| 70–79 | workspace | \`70-workspace/\` |` and `| 80–89 | integrations | \`80-integrations/\` |`; create the two directories.
- [ ] **Step 2: RFC-80** — file `docs/rfc/80-integrations/80-doi-resolution.md`, status `draft`, category integrations; Context: two sentences from the spec §5; Rules R1–R6 verbatim from the spec §5.
- [ ] **Step 3: RFC-70** — file `docs/rfc/70-workspace/70-contribution-workflow.md`, status `draft`, category workspace; Context from the spec §1; Rules R1–R8 verbatim from the spec §6, with R3's response shape and R4's `generated` flag.
- [ ] **Step 4: Amendments**
  - RFC-30: `| \`records.review\` | Neutralise or dispute any record with a note |`.
  - RFC-31 R10: `manager` gains `records.review` (plan 09a).
  - RFC-12: `| \`DOI_LOOKUP_FAILED\` | 502 | The DOI registry could not be reached (RFC-80 R3). |`, `| \`REFERENCE_IS_PERSONAL\` | 409 | A personal-observation reference cannot be edited (RFC-61 R7). |`.
  - RFC-61: R1 columns `kind`, `observer_user_id`; R4 `kind=` filter and item fields `kind`, `observer`; R7, R8 new (spec §4).
  - RFC-63: R1 `intent`, `responds_to_record_id`; R2 check "`intent` null iff `responds_to_record_id` null; a trigger refuses a response to a record of another species or trait"; R7 `record_annotations.reference_id`, `generated`; R8 item `intent`, `respondsTo`; detail `responses`; annotation `reference`, `generated`; R10 `includeMissing`.
  - RFC-65: R1 → "`POST /api/records` is specified by RFC-70 R1–R3; the value, level and number checks below still apply"; R2 → 409 only when nothing was created, details per source; R3 → the permission split of RFC-70 R4; R4 → the contest withdrawal side effect of RFC-70 R5.
  - RFC-66 R2 (columns): "`primary_reference` / `secondary_reference` print `Personal observation` for a reference of kind `personal_observation`".
  - Changelog lines dated 2026-09-17 on each; README rows for RFC-70 (draft), RFC-80 (draft).
- [ ] **Step 5: Commit** — `docs(rfc): RFC-70 contribution workflow, RFC-80 DOI resolution; amend RFC-12/30/31/61/63/65/66 (plan 09a)`.

---

### Task 2: Contracts

**Files:** `packages/contracts/src/dataset.ts`, `curation.ts`, `permissions.ts`, `error-codes.ts`, tests.

**Interfaces (produces):**

```ts
// dataset.ts
export const REFERENCE_KINDS = ['publication', 'personal_observation'] as const;
export const RECORD_INTENTS = ['contest', 'complement'] as const;
export const referenceRefSchema = z.strictObject({ id: z.uuid(), citationKey: z.string(), kind: z.enum(REFERENCE_KINDS) });
export const referenceSchema = … .extend({ kind: z.enum(REFERENCE_KINDS), observer: userRefSchema.nullable() });
export const listReferencesQuerySchema = cursorQuerySchema.extend({ q: searchTermSchema.optional(), kind: z.enum([...REFERENCE_KINDS, 'all']).optional() });
export const recordSchema = … .extend({ intent: z.enum(RECORD_INTENTS).nullable(), respondsTo: z.strictObject({ id: z.uuid() }).nullable() });
export const annotationSchema = … .extend({ reference: referenceRefSchema.nullable(), generated: z.boolean() });
export const recordDetailSchema = … .extend({ responses: z.array(z.strictObject({ id: z.uuid(), intent: z.enum(RECORD_INTENTS), createdBy: userRefSchema.nullable(), createdAt: z.iso.datetime() })) });
export const speciesTraitsQuerySchema = z.strictObject({ includeMissing: z.enum(['true', 'false']).optional() });
// curation.ts
export const doiSchema = z.string().trim().min(7).max(300);
export const sourceRefSchema = z.union([z.strictObject({ id: z.uuid() }), z.strictObject({ doi: doiSchema })]);
export const sourcesSchema = z.union([
  z.strictObject({ personalObservation: z.literal(true) }),
  z.strictObject({ references: z.array(sourceRefSchema).min(1).max(10) }),
]);
export const createRecordBodySchema = z.strictObject({
  speciesId: z.uuid(), traitId: z.uuid(), value: recordValueSchema, sources: sourcesSchema,
  intent: z.enum(RECORD_INTENTS).optional(), respondsToRecordId: z.uuid().optional(),
  rawValue: noteSchema.optional(), note: noteSchema.optional(), secondaryReferenceId: z.uuid().optional(),
}).refine((b) => (b.intent === undefined) === (b.respondsToRecordId === undefined), { path: ['intent'], message: 'intent and respondsToRecordId come together' });
export const createRecordsResultSchema = z.strictObject({ created: z.array(recordDetailSchema), duplicates: z.array(z.strictObject({ recordId: z.uuid(), referenceId: z.uuid() })) });
export const annotateRecordBodySchema = z.strictObject({ kind: z.enum(ANNOTATION_KINDS), note: noteSchema.optional(), reference: sourceRefSchema.optional() })
  .refine((b) => b.reference === undefined || b.kind === 'confirm', { path: ['reference'], message: 'Only a confirmation carries a reference' });
export const resolveDoiQuerySchema = z.strictObject({ doi: doiSchema });
export const resolveDoiResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), reference: referenceSchema }),
  z.strictObject({ status: z.literal('resolvable'), reference: z.null(), preview: z.strictObject({ title: z.string().nullable(), authors: z.string().nullable(), year: z.number().int().nullable(), journal: z.string().nullable() }).nullable() }),
  z.strictObject({ status: z.literal('not_found'), reference: z.null() }),
]);
// permissions.ts: 'records.review'; error-codes.ts: DOI_LOOKUP_FAILED 502, REFERENCE_IS_PERSONAL 409
```

(`recordValueSchema` and `noteSchema` are the existing names in `curation.ts` — verify and reuse.)

- [ ] **Step 1: Failing tests** in `curation.test.ts`: the body refuses `intent` without `respondsToRecordId`; refuses 11 references; accepts `{ personalObservation: true }`; the annotate body refuses `reference` with `kind: 'dispute'`; `resolveDoiResultSchema` parses each variant.
- [ ] **Step 2: Implement; update `apps/web/src/test/dataset-fixtures.ts`** (every `RecordItem` gains `intent: null, respondsTo: null`; every `RecordDetail` gains `responses: []`; every annotation gains `reference: null, generated: false`; every `Reference` gains `kind: 'publication', observer: null`; every `referenceRef` gains `kind`) and the web's `createRecord` call site (`AddValueDialog` sends `sources: { references: [{ id: primary.id }] }` for now — plan 09b replaces the dialog; the web tests must pass at the end of this plan) and `RecordActions`/`useRecordWrite` types for the new `POST /api/records` answer (`created[0]`).
- [ ] **Step 3: Run contracts + web tests; build; commit** — `feat(contracts): sources, intent, reference kinds, resolve DOI, records.review (RFC-70, RFC-80, RFC-61, RFC-63)`.

---

### Task 3: Schema and migrations

**Files:** `apps/api/src/db/schema/references.ts`, `records.ts`, `curation.ts`; migrations `0020_permissions_review.sql` (custom), `0021_contribution.sql` (generated, then hand-append the trigger); tests in `dataset.integration.test.ts`.

- [ ] **Step 1: Failing schema tests**

```ts
describe('RFC-61 R1, R7 reference kinds', () => {
  const t = useTestDb();
  it('personal observation needs an observer, one per user; a publication has none', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(bibliographicReferences).values({ citationKey: `po-${rand()}`, kind: 'personal_observation' })))).rejects.toMatchObject({ code: '23514' });
      await tx.insert(bibliographicReferences).values({ citationKey: `personal-observation:${user.id}`, kind: 'personal_observation', observerUserId: user.id });
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(bibliographicReferences).values({ citationKey: `po2-${rand()}`, kind: 'personal_observation', observerUserId: user.id })))).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('RFC-63 R1, R2 intent and responses', () => {
  const t = useTestDb();
  it('intent and responds_to come together; a response must share species and trait', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx);
      const other = await createTrait(tx);
      const sp1 = await createSpecies(tx);
      const level = trait.levels[0]?.id as string;
      const base = await createRecord(tx, { speciesId: sp1.id, traitId: trait.id, valueText: 'alpha', levelId: level, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(traitRecords).values({ speciesId: sp1.id, traitId: trait.id, valueText: 'beta', levelId: trait.levels[1]?.id, harmonisation: 'harmonised', origin: 'manual', createdBy: user.id, primaryReferenceId: ref.id, intent: 'contest' })))).rejects.toMatchObject({ code: '23514' });
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(traitRecords).values({ speciesId: sp1.id, traitId: other.id, valueText: 'alpha', levelId: other.levels[0]?.id, harmonisation: 'harmonised', origin: 'manual', createdBy: user.id, primaryReferenceId: ref.id, intent: 'contest', respondsToRecordId: base.id })))).rejects.toMatchObject({ code: 'P0001' });
      const [ok] = await tx.insert(traitRecords).values({ speciesId: sp1.id, traitId: trait.id, valueText: 'beta', levelId: trait.levels[1]?.id, harmonisation: 'harmonised', origin: 'manual', createdBy: user.id, primaryReferenceId: ref.id, intent: 'complement', respondsToRecordId: base.id }).returning();
      expect(ok?.intent).toBe('complement');
    });
  });
  it('R7 an annotation reference is allowed on confirm only; generated defaults to false', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const ref = await createReference(tx);
      const trait = await createTrait(tx);
      const sp1 = await createSpecies(tx);
      const rec = await createRecord(tx, { speciesId: sp1.id, traitId: trait.id, valueText: 'alpha', levelId: trait.levels[0]?.id, primaryReferenceId: ref.id, origin: 'manual', createdBy: user.id });
      const [a] = await tx.insert(recordAnnotations).values({ recordId: rec.id, actorId: user.id, kind: 'confirm', referenceId: ref.id }).returning();
      expect(a?.generated).toBe(false);
      await expect(unwrapDbError(tx.transaction((sp) => sp.insert(recordAnnotations).values({ recordId: rec.id, actorId: user.id, kind: 'dispute', note: 'n', referenceId: ref.id })))).rejects.toMatchObject({ code: '23514' });
    });
  });
});
```

- [ ] **Step 2: Schema**

`references.ts` — add `kind: text('kind', { enum: REFERENCE_KINDS }).notNull().default('publication')`, `observerUserId: uuid('observer_user_id').references(() => users.id)`, and in the index list:

```ts
    check('bibliographic_references_kind_check', sql`${t.kind} in ('publication', 'personal_observation')`),
    check('bibliographic_references_observer_check', sql`(${t.kind} = 'personal_observation') = (${t.observerUserId} is not null)`),
    uniqueIndex('bibliographic_references_observer_idx').on(t.observerUserId).where(sql`${t.kind} = 'personal_observation'`),
    index('bibliographic_references_doi_lower_idx').on(sql`lower(${t.doi})`).where(sql`${t.doi} is not null`),
```

`records.ts` — `intent: text('intent', { enum: RECORD_INTENTS })`, `respondsToRecordId: uuid('responds_to_record_id').references((): AnyPgColumn => traitRecords.id, { onDelete: 'restrict' })`, plus:

```ts
    index('trait_records_responds_to_idx').on(t.respondsToRecordId).where(sql`${t.respondsToRecordId} is not null`),
    check('trait_records_intent_check', sql`(${t.intent} is null) = (${t.respondsToRecordId} is null)`),
```

`curation.ts` — `referenceId: uuid('reference_id').references(() => bibliographicReferences.id, { onDelete: 'restrict' })`, `generated: boolean('generated').notNull().default(false)`, check `record_annotations_reference_check`: `${t.referenceId} is null or ${t.kind} = 'confirm'`.

- [ ] **Step 3: Migrations** — `0020_permissions_review.sql`: insert `records.review` and `INSERT INTO role_permissions … WHERE r.name = 'manager' AND p.key = 'records.review'`. `db:generate --name contribution`, then append to the generated file:

```sql
--> statement-breakpoint
-- RFC-63 R2: a response names a record of the same species and trait.
CREATE FUNCTION trait_records_response_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target trait_records%ROWTYPE;
BEGIN
  IF NEW.responds_to_record_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO target FROM trait_records WHERE id = NEW.responds_to_record_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'responds_to_record_id % does not exist', NEW.responds_to_record_id; END IF;
  IF target.species_id <> NEW.species_id OR target.trait_id <> NEW.trait_id THEN
    RAISE EXCEPTION 'a response must share the species and trait of the record it responds to';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trait_records_response_check BEFORE INSERT ON trait_records
FOR EACH ROW EXECUTE FUNCTION trait_records_response_check();
```

(A `RAISE EXCEPTION` without an ERRCODE is `P0001`, which the test expects.)

- [ ] **Step 4: Run; commit** — `feat(db): reference kinds, record intent and responses, annotation reference and generated flag, records.review (RFC-61 R7, RFC-63 R1-R2, R7)`.

---

### Task 4: DOI client

**Files:** `apps/api/src/integrations/http.ts`, `apps/api/src/integrations/doi.ts`, `doi.test.ts`, `doi.property.test.ts`, `apps/api/test/helpers/doi.ts`, `apps/api/src/config.ts`, `auth/context.ts`, `app.ts`, `server.ts`, `test/helpers/app.ts`

**Interfaces (produces):**

```ts
// http.ts
export interface FixedHostFetchOptions { url: URL; allowedHost: string; headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch }
export type FixedHostResult = { ok: true; status: number; json: unknown } | { ok: false; status: number } | { ok: false; error: 'timeout' | 'network' | 'redirect' | 'too_large' | 'invalid_json' };
export async function fetchJsonFixedHost(o: FixedHostFetchOptions): Promise<FixedHostResult>
// doi.ts
export function normaliseDoi(text: string): string | null           // RFC-80 R1; null when malformed
export interface DoiMetadata { title: string | null; authors: string | null; year: number | null; journal: string | null }
export interface DoiClient { exists(doi: string): Promise<'resolvable' | 'not_found' | 'failed'>; metadata(doi: string): Promise<DoiMetadata | null> }
export function createDoiClient(options: { contactEmail?: string; version: string; fetchImpl?: typeof fetch }): DoiClient
export function crossrefToMetadata(work: unknown): DoiMetadata      // exported for the unit test
// test/helpers/doi.ts
export function fakeDoiClient(): DoiClient & { known: Map<string, DoiMetadata | null>; failing: boolean }  // exists: 'resolvable' when in `known`, 'failed' when `failing`, else 'not_found'
```

- [ ] **Step 1: Failing unit tests**

`doi.test.ts`:
```ts
describe('RFC-80 R1 normaliseDoi', () => {
  it('strips resolver prefixes, lowercases, validates', () => {
    expect(normaliseDoi(' https://doi.org/10.1111/GEB.13000 ')).toBe('10.1111/geb.13000');
    expect(normaliseDoi('doi:10.5061/dryad.abc')).toBe('10.5061/dryad.abc');
    expect(normaliseDoi('http://dx.doi.org/10.1/x')).toBeNull();      // registrant too short
    expect(normaliseDoi('11.1111/x')).toBeNull();
    expect(normaliseDoi('10.1111/')).toBeNull();
    expect(normaliseDoi(`10.1111/${'a'.repeat(201)}`)).toBeNull();
  });
});
describe('RFC-61 R8 crossrefToMetadata', () => {
  it('maps a Crossref work', () => {
    expect(crossrefToMetadata({ message: { title: ['Seed size'], author: [{ family: 'Alfaro', given: 'A' }, { family: 'Diaz', given: 'B' }], issued: { 'date-parts': [[2023, 4]] }, 'container-title': ['Global Ecology'] } }))
      .toEqual({ title: 'Seed size', authors: 'Alfaro, A; Diaz, B', year: 2023, journal: 'Global Ecology' });
    expect(crossrefToMetadata({ message: {} })).toEqual({ title: null, authors: null, year: null, journal: null });
  });
});
describe('RFC-80 R2, R3 createDoiClient', () => {
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  it('exists: responseCode 1 → resolvable; 100 or 404 → not_found; redirect or network → failed', async () => {
    expect(await createDoiClient({ version: 't', fetchImpl: respond(200, { responseCode: 1 }) }).exists('10.1/x')).toBe('resolvable');
    expect(await createDoiClient({ version: 't', fetchImpl: respond(200, { responseCode: 100 }) }).exists('10.1/x')).toBe('not_found');
    expect(await createDoiClient({ version: 't', fetchImpl: respond(404, {}) }).exists('10.1/x')).toBe('not_found');
    expect(await createDoiClient({ version: 't', fetchImpl: respond(302, {}, { location: 'https://x' }) }).exists('10.1/x')).toBe('failed');
    expect(await createDoiClient({ version: 't', fetchImpl: async () => { throw new TypeError('fetch failed'); } }).exists('10.1/x')).toBe('failed');
  });
  it('calls the two fixed hosts only, with the User-Agent', async () => {
    const calls: { url: string; ua: string | null }[] = [];
    const client = createDoiClient({ version: '1.2', contactEmail: 'ops@example.test', fetchImpl: async (input, init) => { calls.push({ url: String(input), ua: new Headers(init?.headers).get('user-agent') }); return new Response('{"responseCode":1,"message":{}}', { status: 200 }); } });
    await client.exists('10.1111/geb.13000');
    await client.metadata('10.1111/geb.13000');
    expect(calls.map((c) => c.url)).toEqual(['https://doi.org/api/handles/10.1111%2Fgeb.13000', 'https://api.crossref.org/works/10.1111%2Fgeb.13000']);
    expect(calls[0]?.ua).toBe('TreeRepro/1.2 (mailto:ops@example.test)');
  });
});
```

`doi.property.test.ts` (fast-check): for any prefix in `['', 'doi:', 'DOI:', 'https://doi.org/', 'http://dx.doi.org/']`, any 4–9 digit registrant and any suffix of 1–50 `[A-Za-z0-9._;()/-]` characters, `normaliseDoi(prefix + '10.' + reg + '/' + suffix)` equals `('10.' + reg + '/' + suffix).toLowerCase()`; and `normaliseDoi` is idempotent on its own output.

- [ ] **Step 2: Implement `http.ts`**

```ts
/** @rfc RFC-80 R3, R6 */
export async function fetchJsonFixedHost(o: FixedHostFetchOptions): Promise<FixedHostResult> {
  if (o.url.protocol !== 'https:' || o.url.host !== o.allowedHost) throw new Error(`host ${o.url.host} is not ${o.allowedHost}`);
  const fetchImpl = o.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 5000);
  try {
    const res = await fetchImpl(o.url, { headers: { accept: 'application/json', ...o.headers }, redirect: 'manual', signal: controller.signal });
    if (res.status >= 300 && res.status < 400) return { ok: false, error: 'redirect' };
    const length = Number(res.headers.get('content-length') ?? 0);
    const max = o.maxBytes ?? 1024 * 1024;
    if (length > max) return { ok: false, error: 'too_large' };
    const text = await res.text();
    if (text.length > max) return { ok: false, error: 'too_large' };
    if (!res.ok) return { ok: false, status: res.status };
    try { return { ok: true, status: res.status, json: JSON.parse(text) as unknown }; } catch { return { ok: false, error: 'invalid_json' }; }
  } catch (err) {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
}
```

`doi.ts`:

```ts
const DOI_PATTERN = /^10\.\d{4,9}\/\S{1,200}$/;
const PREFIXES = ['https://doi.org/', 'http://doi.org/', 'https://dx.doi.org/', 'http://dx.doi.org/', 'doi:'];

/** @rfc RFC-80 R1 */
export function normaliseDoi(text: string): string | null {
  let s = text.trim();
  const lower = s.toLowerCase();
  for (const p of PREFIXES) if (lower.startsWith(p)) { s = s.slice(p.length); break; }
  s = s.toLowerCase();
  return DOI_PATTERN.test(s) ? s : null;
}

/** @rfc RFC-61 R8 */
export function crossrefToMetadata(work: unknown): DoiMetadata {
  const m = (work as { message?: Record<string, unknown> })?.message ?? {};
  const title = Array.isArray(m.title) && typeof m.title[0] === 'string' ? m.title[0] : null;
  const authors = Array.isArray(m.author)
    ? m.author.map((a: { family?: string; given?: string; name?: string }) => [a.family, a.given].filter(Boolean).join(', ') || a.name || '').filter(Boolean).join('; ').slice(0, 1000) || null
    : null;
  const parts = (m.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0];
  const year = parts && Number.isInteger(parts[0]) ? (parts[0] as number) : null;
  const journal = Array.isArray(m['container-title']) && typeof m['container-title'][0] === 'string' ? m['container-title'][0] : null;
  return { title, authors, year, journal };
}

/** @rfc RFC-80 R2, R3 */
export function createDoiClient(options: { contactEmail?: string; version: string; fetchImpl?: typeof fetch }): DoiClient {
  const ua = `TreeRepro/${options.version}${options.contactEmail ? ` (mailto:${options.contactEmail})` : ''}`;
  const headers = { 'user-agent': ua };
  return {
    async exists(doi) {
      const r = await fetchJsonFixedHost({ url: new URL(`https://doi.org/api/handles/${encodeURIComponent(doi)}`), allowedHost: 'doi.org', headers, fetchImpl: options.fetchImpl });
      if (r.ok) return (r.json as { responseCode?: number }).responseCode === 1 ? 'resolvable' : 'not_found';
      if ('status' in r && r.status === 404) return 'not_found';
      return 'failed';
    },
    async metadata(doi) {
      const r = await fetchJsonFixedHost({ url: new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`), allowedHost: 'api.crossref.org', headers, fetchImpl: options.fetchImpl });
      return r.ok ? crossrefToMetadata(r.json) : null;
    },
  };
}
```

Wiring: `AuthContext.doi: DoiClient`; `AppDeps.doi`; `server.ts` builds `createDoiClient({ contactEmail: config.doiContactEmail, version: <package version read from package.json or a constant> })`; `config.ts` reads `DOI_CONTACT_EMAIL` (optional, e-mail format); `test/helpers/app.ts` injects `fakeDoiClient()` and exposes it as `t.doi`.

- [ ] **Step 3: Run unit + property tests; commit** — `feat(api): DOI client over the Handle and Crossref APIs (RFC-80 R1-R3, R6)`.

---

### Task 5: References — personal observation, DOI lookup, kind filter, `resolve` route

**Files:** `apps/api/src/dataset/references.ts`, `catalog.ts` (`updateReference` refuses personal), `sources.ts` (+ test), `export.ts`, `http/routes/dataset/references.ts` (+ test), meta-test list (`GET /api/references/resolve` — register it **before** `/:id`).

**Interfaces (produces):**

```ts
export async function ensurePersonalObservation(db, userId: string): Promise<{ id: string }>                      // RFC-61 R7; audit references.created { kind }
export async function findReferenceByDoi(db, doi: string): Promise<Reference | null>                             // lower(doi)
export async function createReferenceFromDoi(db, input: { doi: string; metadata: DoiMetadata | null; actorId: string }): Promise<Reference>  // RFC-61 R8; races → re-read
export type SourceInput = { personalObservation: true } | { references: ({ id: string } | { doi: string })[] };
export async function resolveSources(ctx: { db; doi: DoiClient }, actorId: string, sources: SourceInput, path = 'sources'): Promise<string[]>   // RFC-80 R5
export async function resolveDoi(ctx, doi: string): Promise<ResolveDoiResult>                                   // RFC-80 R4
```

`toReference` adds `kind` and `observer` (join `users` on `observer_user_id`; the name column decrypts). `searchReferences` takes `kind` (`'publication'` default; `'all'` no filter). `referenceRef` builders in `records.ts` add `kind`.

- [ ] **Step 1: Failing tests** (`sources.integration.test.ts` and `references.integration.test.ts`):
  - `ensurePersonalObservation` twice for one user → same id, one audit entry.
  - `resolveSources` with `{ personalObservation: true }` → `[po.id]`; with `[{ id: existing }]` → `[existing]`; with `[{ doi: '10.1111/X' }]` when `t.doi.known` has it → creates a reference (`citationKey 'doi:10.1111/x'`, title from metadata, `url 'https://doi.org/10.1111/x'`, audit `references.created` with `metadata.source = 'doi'`) and a second call returns the same id without a second audit; unknown DOI → 400 `VALIDATION_FAILED` path `sources.references.0.doi`; `t.doi.failing = true` → 502 `DOI_LOOKUP_FAILED`; malformed → 400; duplicate DOIs in one call → 400 (path of the second).
  - `searchReferences` default omits personal observations; `kind=all` includes them with `observer.name`.
  - `updateReference` on a personal observation → 409 `REFERENCE_IS_PERSONAL`.
  - Route `GET /api/references/resolve?doi=` with a contributor session: `known`, `resolvable` (with `preview`), `not_found`; 400 on malformed; 61st call in a minute → 429 (use `t.limiter` conventions from the auth tests).
  - Export: a record whose primary reference is a personal observation prints `Personal observation` in `primary_reference`.
- [ ] **Step 2: Implement** — `sources.ts`:

```ts
/** @rfc RFC-80 R5 */
export async function resolveSources(ctx, actorId, sources, path = 'sources'): Promise<string[]> {
  if ('personalObservation' in sources) return [(await ensurePersonalObservation(ctx.db, actorId)).id];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const [i, s] of sources.references.entries()) {
    const p = `${path}.references.${i}`;
    if ('id' in s) {
      const found = await getReference(ctx.db, s.id);
      if (!found) throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found', [{ path: `${p}.id`, message: 'Reference not found' }]);
      if (seen.has(found.id)) throw validation(`${p}.id`, 'Duplicate reference');
      seen.add(found.id); ids.push(found.id); continue;
    }
    const doi = normaliseDoi(s.doi);
    if (!doi) throw validation(`${p}.doi`, 'Malformed DOI');
    if (seen.has(`doi:${doi}`)) throw validation(`${p}.doi`, 'Duplicate DOI');
    seen.add(`doi:${doi}`);
    const known = await findReferenceByDoi(ctx.db, doi);
    if (known) { ids.push(known.id); continue; }
    const status = await ctx.doi.exists(doi);
    if (status === 'failed') throw new AppError('DOI_LOOKUP_FAILED', 'The DOI registry could not be reached');
    if (status === 'not_found') throw validation(`${p}.doi`, 'DOI does not resolve');
    const created = await createReferenceFromDoi(ctx.db, { doi, metadata: await ctx.doi.metadata(doi), actorId });
    ids.push(created.id);
  }
  return ids;
}
```

`createReferenceFromDoi`: transaction — insert with `citationKey: \`doi:${doi}\``, `doi`, `url`, metadata fields, `shortCitation` derivation is plan 10d (leave null), `createdBy: actorId`, audit `references.created` `{ source: 'doi' }`; on `isUniqueViolation` (a race on `doi` or `citation_key`) re-read by `findReferenceByDoi`.

Route: `.get('/resolve', requirePermission(ctx, 'dataset.read'), doiLimit, validate('query', resolveDoiQuerySchema), …)` — the permission is `records.create` per the spec §5 R4; use `records.create`. Rate limit: build with `createRateLimiter` keyed `doi:<userId>`, 60 per 60 s (look at how `forgotLimit` is built in `auth.ts` and copy the shape).

`export.ts`: in the CSV query, `case when r.kind = 'personal_observation' then 'Personal observation' else r.citation_key end` for both reference columns.

- [ ] **Step 3: Run; commit** — `feat(api): personal-observation references, DOI-created references, source resolution, GET /api/references/resolve (RFC-61 R7-R8, RFC-80 R4-R5)`.

---

### Task 6: `createRecords`, intent, contest side effects, review gate, withdrawal side effect

**Files:** `apps/api/src/dataset/curation.ts` (+ test), `records.ts` (+ test), `http/routes/dataset/records.ts` (+ test).

**Interfaces (produces):**

```ts
export interface CreateRecordsInput { actorId: string; speciesId: string; traitId: string; value: RecordValue; referenceIds: string[]; intent?: RecordIntent; respondsToRecordId?: string; rawValue?: string; note?: string; secondaryReferenceId?: string }
export interface CreateRecordsResult { created: RecordDetail[]; duplicates: { recordId: string; referenceId: string }[] }
export async function createRecords(db, visibility, input: CreateRecordsInput): Promise<CreateRecordsResult>   // RFC-70 R2, R3
export interface AnnotateRecordInput { recordId; actorId; kind; note?; referenceId?: string; canWithdrawAny: boolean; canReview: boolean }
export async function annotateRecord(db, visibility, input): Promise<RecordDetail>                            // RFC-70 R4, R5
export const CONTEST_NOTE = (ids: string[]) => `Contested by record ${ids.join(', ')}`;
export const CONTEST_WITHDRAWN_NOTE = (id: string) => `Contest withdrawn (record ${id})`;
```

The old `createRecord` is removed (its only caller was the route); `mapPending` keeps its own insert.

- [ ] **Step 1: Failing service tests** (`curation.integration.test.ts`):
  - two references → two records, identical except `primary_reference_id`; both in `created` in input order; `duplicates` empty.
  - one of two claims already exists → `created` has one, `duplicates` names the existing record and the reference; when both exist → 409 `RECORD_DUPLICATE` with two details `sources.references.<i>`.
  - contest: `intent: 'contest', respondsToRecordId: base` → the new record has `intent`, `respondsTo`; the base record now has one `dispute` annotation by the actor with `generated: true` and note `Contested by record <newId>`; review of base is `disputed`; with two references the note lists both ids and there is exactly one annotation.
  - complement inserts no annotation on the base.
  - respondsTo of another trait → 400 path `respondsToRecordId`; withdrawn base → 409 `RECORD_WITHDRAWN`; invisible base (inactive species, `RESTRICTED`) → 404.
  - `annotateRecord` `neutral` with `canReview: false` → 403; `dispute` with `canReview: false` → 403; `confirm` with `referenceId` stores it and the detail's annotation carries `reference.kind`.
  - withdrawing a contest record inserts a generated `neutral` on the base when the actor's latest stance there is `dispute`; not when the actor had since confirmed; withdrawing a complement inserts nothing.
- [ ] **Step 2: Implement** — `createRecords`: `requireSpecies`, `requireTrait` (visibility), inactive trait check, `resolveValue`, optional `requireReference(secondary)`; when `respondsToRecordId`: read the record joined with species/traits + visibility (404), compare species/trait (400), `reviewStatusSql` withdrawn (409); then `db.transaction`: `pg_advisory_xact_lock` on the responded record id when contesting (the same key `annotateRecord` uses); `insert … values(referenceIds.map(…)) on conflict on constraint trait_records_claim_key do nothing returning id, primary_reference_id`; for references missing from `returning`, select the existing record by the claim key → `duplicates`; if `created` is empty → 409 with details; if contest and created non-empty → insert the dispute annotation (`generated: true`); load details with `getRecord(tx, UNRESTRICTED, id)` for each created id (the actor just wrote them). `annotateRecord`: add the `canReview` gate before the withdraw block; store `referenceId`; after inserting a `withdraw` on a record with `intent = 'contest'`, check the actor's latest non-withdraw annotation on `responds_to_record_id` — when it is `dispute`, insert `neutral` with `generated: true` and the note.

  `records.ts`: `toItem` adds `intent`, `respondsTo`; `getRecord` adds `responses` (select from `trait_records where responds_to_record_id = id order by id desc`, join author) and annotation `reference` (join `bibliographic_references`) and `generated`.

  Route `POST /api/records`: `validate('json', createRecordBodySchema)`; `const referenceIds = await resolveSources({ db: ctx.db, doi: ctx.doi }, actor.id, body.sources)`; `createRecords(ctx.db, visibility, { … })`; `c.json({ data: result }, 201)`. Route `POST /:id/annotations`: `canReview: currentPermissions(c).has('records.review')`; `referenceId` from `resolveSources(…, { references: [body.reference] })[0]` when given.

- [ ] **Step 3: Route tests** — contributor session: `POST /api/records` with `{ personalObservation: true }` → 201 with one record whose `primaryReference.kind === 'personal_observation'`; `POST …/annotations { kind: 'neutral' }` → 403 for contributor, 201 for manager; `{ kind: 'confirm', reference: { doi } }` with `t.doi.known` set → 201 and `annotations[0].reference` set.
- [ ] **Step 4: Run the whole api:integration project (queue tests use `createRecord` helpers, not the service — verify); commit** — `feat(api): multi-reference record creation with intent, generated contest annotations, records.review gate (RFC-70 R1-R6)`.

---

### Task 7: `includeMissing` on the species trait summary

**Files:** `apps/api/src/dataset/summary.ts` (+ test), `http/routes/dataset/species.ts` (+ test).

- [ ] **Step 1: Failing test** — a species with a record on trait A; `speciesTraitSummary(db, RESTRICTED, id, { includeMissing: true })` lists every visible active trait, A with counts and the others with `recordCount 0`, `levels: null`, `numeric: null`, `accepted: null`, categories in dictionary order and categories with only missing traits present; inactive traits absent for `RESTRICTED`, present (count 0) for `UNRESTRICTED`; without the flag the response is unchanged.
- [ ] **Step 2: Implement** — build the answer from the dictionary (`getDictionary(db, visibility)`) when `includeMissing`, merging the aggregates by trait id; the route validates `speciesTraitsQuerySchema` and passes `includeMissing === 'true'`.
- [ ] **Step 3: Commit** — `feat(api): includeMissing on the species trait summary (RFC-70 R7, RFC-63 R10)`.

---

### Task 8: Docs, RFC status, close-out

- [ ] **Step 1:** RFC-70, RFC-80 → `accepted`; README index; spec status line; `.env.example` gains `DOI_CONTACT_EMAIL=`; `compose.e2e.yml` leaves it unset; `docs/gotchas/dataset.md`: "`POST /api/records` resolves DOIs before its transaction: a reference may exist after a failed record write — that is intended (RFC-80 R5)"; README API paragraph mentions `GET /api/references/resolve` and `records.review`.
- [ ] **Step 2:** `pnpm lint`, `pnpm typecheck`, `pnpm rfc:check`, `pnpm test`, `pnpm build`; the web tests pass with the contracts change (Task 2). Commit `docs: RFC-70 and RFC-80 accepted; DOI contact e-mail; gotchas (plan 09a)`; push; PR `feat(api): contribution workflow — personal observations, DOI resolution, intent, reviewer gate (plan 09a)`; one CodeRabbit run.

## Self-review

- Spec §3 data model → Task 3; §4 references → Task 5; §5 DOI R1–R6 → Tasks 4, 5; §6 R1–R8 → Tasks 6, 7 (R8 audit: Task 5); §8 tests → each task.
- Names: `resolveSources(ctx, actorId, sources, path)` (Task 5) used by the routes in Task 6; `createRecords` result shape matches `createRecordsResultSchema` (Task 2); `fakeDoiClient().known` / `.failing` used in Tasks 5–6; `annotateRecord` input gains `referenceId` and `canReview` (Task 6) — the harmonisation mapping (`mapPending`) is untouched.

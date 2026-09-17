# Platform 12c — Species Proposals and Taxonomy Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** Contributors propose a species name; the API looks it up in GBIF (backbone and the WCVP checklist) and stores the match; admins see a queue, approve (creating the species) or reject; proposers follow the status in My contributions; the species dialog gains a "Look up" button.

**Architecture:** `apps/api/src/integrations/taxonomy.ts` (`TaxonomyClient` over `fetchJsonFixedHost` from plan 09a; fake in tests); `apps/api/src/dataset/proposals.ts` (create with lookup, list, get, approve, reject, mine); routes under `/api/species/proposals` (registered before `/:id`) and `/api/me/proposals`, `/api/taxonomy/match`; the `contributor` and `manager` roles gain `taxa.propose`.

**Spec:** `docs/specs/2026-09-17-platform-design.md` §5, §6, §8, §9. Depends on plans 09a (`fetchJsonFixedHost`), 11a (Proposals tab), 11b (dashboard `queues.proposals`), 12b (digest `proposals`).

## Global Constraints

Same as plan 08a. Branch `feat/platform-12c` in worktree `../Elisa-12c`. New env `WCVP_GBIF_DATASET_KEY` (default: the GBIF dataset key of the WCVP checklist — look it up on gbif.org at implementation time, record it in `.env.example` and in RFC-81 R1 with the date checked).

## File structure (end state)

```
docs/rfc/70-workspace/75-species-proposals.md, 80-integrations/81-taxonomy-lookup.md
docs/rfc/10-platform/12-error-codes.md, 30-access/30-permission-catalog.md, 31-roles.md, 40-data-protection/41-audit-log.md, 13-presentation-layer.md
apps/api/drizzle/0029_proposals.sql                     # custom permission + role rows; generated table (two files or one custom with both)
apps/api/src/db/schema/proposals.ts (+ test)
apps/api/src/integrations/taxonomy.ts (+ .test.ts), test/helpers/taxonomy.ts
apps/api/src/config.ts, auth/context.ts, app.ts, server.ts, test/helpers/app.ts
apps/api/src/dataset/proposals.ts (+ .integration.test.ts)
apps/api/src/http/routes/dataset/proposals.ts (+ test), species.ts (mount order), taxonomy.ts, me route for /me/proposals
apps/api/src/workspace/dashboard.ts, jobs/digest.ts        # proposals counts
packages/contracts/src/proposals.ts (+ test), index.ts, permissions.ts, error-codes.ts, audit.ts
apps/web/src/api/proposals.ts
apps/web/src/components/catalog/ProposeSpeciesDialog.tsx (+ test), SpeciesDialog.tsx (Look up)
apps/web/src/pages/curation/ProposalsPage.tsx (+ test), components/curation/ProposalDrawer.tsx, LookupCard.tsx (+ tests)
apps/web/src/pages/dataset/SpeciesSearchPage.tsx        # empty state with Propose
apps/web/src/pages/workspace/ContributionsPage.tsx      # Proposals tab
apps/web/src/routes/app/curation/proposals.tsx, components/shell/nav.ts
apps/web/src/content/help/scope.tsx                     # missing-species section links to proposals
```

---

### Task 1: RFCs, permission, codes, actions

- [ ] RFC-75 (`draft`, R1–R7 from the spec §5) and RFC-81 (`draft`, R1–R4 from the spec §6); RFC-12 `PROPOSAL_EXISTS` 409, `PROPOSAL_NOT_FOUND` 404, `PROPOSAL_DECIDED` 409, `TAXONOMY_LOOKUP_FAILED` 502; RFC-30 `taxa.propose` "Propose a species for the catalog"; RFC-31 R10 contributor and manager += `taxa.propose`; RFC-41 `proposals.created`, `proposals.decided`; RFC-13 route `/app/curation/proposals`. README rows. Commit.

---

### Task 2: Contracts

```ts
export const PROPOSAL_STATUSES = ['open', 'approved', 'rejected'] as const;
export const LOOKUP_VERDICTS = ['exact', 'fuzzy', 'none', 'failed'] as const;
export const taxonMatchSchema = z.strictObject({ matchType: z.enum(['EXACT', 'FUZZY', 'HIGHERRANK', 'NONE']), confidence: z.number().int().nullable(), usageKey: z.number().int().nullable(), scientificName: z.string().nullable(), canonicalName: z.string().nullable(), rank: z.string().nullable(), status: z.string().nullable(), family: z.string().nullable(), genus: z.string().nullable(), acceptedUsageKey: z.number().int().nullable(), note: z.string().nullable() });
export const lookupSchema = z.strictObject({ backbone: taxonMatchSchema.nullable(), wcvp: taxonMatchSchema.nullable(), verdict: z.enum(LOOKUP_VERDICTS) });
export const proposalSchema = z.strictObject({ id: z.uuid(), proposedName: z.string(), note: z.string().nullable(), status: z.enum(PROPOSAL_STATUSES), proposer: userRefSchema, lookup: lookupSchema.nullable(), lookupAt: z.iso.datetime().nullable(), species: z.strictObject({ id: z.uuid(), canonicalName: z.string() }).nullable(), decidedBy: userRefSchema.nullable(), decidedAt: z.iso.datetime().nullable(), decisionNote: z.string().nullable(), createdAt: z.iso.datetime() });
export const createProposalBodySchema = z.strictObject({ name: z.string().trim().min(3).max(200), note: noteSchema.optional() });
export const listProposalsQuerySchema = cursorQuerySchema.extend({ status: z.enum(PROPOSAL_STATUSES).optional() });
export const approveProposalBodySchema = z.strictObject({ canonicalName: catalogNameSchema, nameSource: z.enum(NAME_SOURCES), genusName: catalogNameSchema.optional(), familyName: catalogNameSchema.optional(), alternativeNames: z.array(speciesNameBodySchema).max(20).optional() });
export const rejectProposalBodySchema = z.strictObject({ note: noteSchema });
export const taxonomyMatchQuerySchema = z.strictObject({ name: z.string().trim().min(3).max(200) });
```

- [ ] Tests; implement; build; commit — `feat(contracts): species proposals and taxonomy lookup (RFC-75, RFC-81)`.

---

### Task 3: Schema and migration

- [ ] Failing schema test — checks: `open` ⇔ `decided_at is null`; `approved` ⇔ `species_id not null`; unique open name case-insensitively (23505 on a second open row with a different case); implement per the spec §5 R1; custom migration part: permission + role rows for contributor and manager. Commit — `feat(db): species_proposals, taxa.propose (RFC-75 R1)`.

---

### Task 4: Taxonomy client

**Interfaces:**

```ts
export interface TaxonMatch { … as taxonMatchSchema … }
export interface TaxonomyLookup { backbone: TaxonMatch | null; wcvp: TaxonMatch | null; verdict: 'exact' | 'fuzzy' | 'none' | 'failed' }
export interface TaxonomyClient { match(name: string): Promise<TaxonomyLookup> }
export function createTaxonomyClient(o: { wcvpDatasetKey: string; version: string; fetchImpl?: typeof fetch }): TaxonomyClient
export function gbifToMatch(json: unknown): TaxonMatch
export function verdictOf(backbone: TaxonMatch | null, wcvp: TaxonMatch | null, failures: number): TaxonomyLookup['verdict']
// test/helpers/taxonomy.ts
export function fakeTaxonomyClient(): TaxonomyClient & { answers: Map<string, TaxonomyLookup>; failing: boolean }
```

- [ ] **Step 1: Failing unit tests** — `gbifToMatch` on a fixture of an EXACT species match, a FUZZY one, a HIGHERRANK (genus) one (→ `matchType 'HIGHERRANK'`, `note 'matched the genus'`), and `{ matchType: 'NONE' }`; `verdictOf`: EXACT at species rank on either → `exact`; FUZZY → `fuzzy`; both NONE/HIGHERRANK → `none`; both failed → `failed`; one failed + one NONE → `none`; the client calls `https://api.gbif.org/v1/species/match?verbose=true&name=Quercus%20robur` and the same with `&datasetKey=<key>`; a network failure on one call is a `null` for that source.
- [ ] **Step 2: Implement** (`fetchJsonFixedHost` with `allowedHost: 'api.gbif.org'`); wire `ctx.taxonomy`, config `wcvpGbifDatasetKey`, the fake in `useTestApp` (`t.taxonomy`).
- [ ] **Step 3: Commit** — `feat(api): GBIF taxonomy match client (RFC-81 R1-R3)`.

---

### Task 5: Proposals service and routes

**Interfaces:**

```ts
export async function createProposal(ctx: { db; taxonomy }, visibility, input: { name; note?; proposerId }): Promise<Proposal>
export async function listProposals(db, input: { status?; cursor?; limit }): Promise<{ data: Proposal[]; nextCursor }>
export async function getProposal(db, id): Promise<Proposal | null>
export async function listMyProposals(db, userId, input: { cursor?; limit }): Promise<{ data; nextCursor }>
export async function approveProposal(db, input: { id; body: ApproveProposalBody; actorId }): Promise<Proposal>   // uses catalog.createSpecies + genus/family creation like SpeciesDialog's inline path (see catalog.ts createSpecies with genusName/familyName if it exists; else create through createFamily/createGenus)
export async function rejectProposal(db, input: { id; note; actorId }): Promise<Proposal>
export async function matchTaxon(ctx, name): Promise<TaxonomyLookup>          // GET /api/taxonomy/match; 502 when verdict failed
export async function countOpenProposals(db): Promise<number>                  // dashboard
export async function countProposalsCreated(db, window): Promise<number>       // digest
```

Routes: `POST /api/species/proposals` (`taxa.propose`, 201), `GET /api/species/proposals` (`taxa.manage`), `GET /api/species/proposals/:id` (`taxa.manage`), `POST /api/species/proposals/:id/approve`, `POST /api/species/proposals/:id/reject` (`taxa.manage`), `GET /api/me/proposals` (`taxa.propose`), `GET /api/taxonomy/match?name=` (`taxa.manage`, rate limit 30/min). Mount the proposals router on `speciesRoutes` **before** the `/:id` routes (Hono matches in registration order). Meta-test list.

- [ ] **Step 1: Failing tests** — create stores the lookup from the fake (`exact`), audits `proposals.created` (no name in metadata); a visible species with the same canonical name → 409 `SPECIES_NAME_TAKEN` with the id; a species with that alternative name → 409; an open proposal with the same name in another case → 409 `PROPOSAL_EXISTS`; the fake `failing` → the proposal is still created with `lookup null`; list by status newest first; approve creates the species with genus/family from the body, links `species_id`, sets `approved`, audits `taxa.created` and `proposals.decided { decision: 'approved', speciesId }`; a second decision → 409 `PROPOSAL_DECIDED`; reject stores the note; `listMyProposals` returns the proposer's rows in any status; `matchTaxon` 502 on `failed`; `countOpenProposals`; the dashboard's `queues.proposals` and the digest's `proposals` pick them up (update those two tests).
- [ ] **Step 2: Implement; commit** — `feat(api): species proposals with GBIF lookup, approval queue (RFC-75 R1-R7, RFC-81 R4)`.

---

### Task 6: Web

- [ ] **Step 1: Failing tests** — species search empty state with `taxa.propose`: "No species matches *q*" + **Propose this species** → `ProposeSpeciesDialog` (name prefilled, note; 409 mappings "This species exists — open it" with a link, "Already proposed"); `ProposalsPage` (nav "Proposals" under Curation with `taxa.manage`): table (name, proposer, date, verdict badge), row → `ProposalDrawer` with two `LookupCard`s (scientific name, rank, status, family, genus, confidence, link `https://www.gbif.org/species/<usageKey>` with `rel="noopener noreferrer"`), **Approve** opens `SpeciesDialog` prefilled (canonical name from the WCVP match when `exact`, else backbone, else the proposed name; `nameSource` `wcvp` / `gbif` / `original` accordingly; genus and family names) whose save calls `approveProposal`, **Reject** asks a note; `ContributionsPage` gains a Proposals tab (status badge, decision note, link to the species); `SpeciesDialog` (create mode) gains **Look up** calling `matchTaxon` and filling genus/family; the help topic `scope#missing-species` now links to the propose flow.
- [ ] **Step 2: Implement; commit** — `feat(web): propose a species, proposals queue with GBIF match cards, look-up in the species dialog (RFC-75, RFC-81)`.

---

### Task 7: Close-out

- [ ] `.env.example` `WCVP_GBIF_DATASET_KEY=`; RFC-75, RFC-81 → accepted; spec status; E2E: a contributor proposes a name (the E2E stack has no network — the proposal stores `lookup null` and the verdict badge reads "lookup failed"; assert that), the admin approves it from the queue, the species appears in the contributor's list. Full checks; PR `feat: species proposals and taxonomy lookup (plan 12c)`; one CodeRabbit run.

## Self-review

- Spec §5 R1 → Task 3; R2–R7 → Task 5; §6 R1–R4 → Tasks 4–5; web → Task 6; §8 codes/actions/permissions → Task 1.

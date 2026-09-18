# TreeRepro — Contribution Workflow Design (plans 09a, 09b)

**Date:** 2026-09-17
**Status:** 09a implemented (API, PR #89); 09b implemented (web); implementation plans `2026-09-17-contribution-09a-api.md` and `2026-09-17-contribution-09b-web.md`
**Scope:** how a contributor validates a record, contests or complements it, and adds entries for a trait: personal-observation provenance, DOI-based references resolved through the Handle and Crossref APIs, several references per submission, the contest / complement intent and its side effects, the reviewer permission, the two-button record UI, the two-step contest dialog, the redesigned add-entries form, trait tooltips and the "traits with no data" view. RFC-70 (contribution workflow), RFC-80 (DOI resolution), amendments to RFC-30, RFC-31, RFC-41, RFC-61, RFC-63, RFC-65, RFC-12. Programme index: `2026-09-17-contributor-launch-overview.md`. Depends on plan 08a (visibility) and 08b (plots).

## 1. Context

Plan 07 shipped the write side for curators: a record form with citation-key references, secondary reference, "as written in the source" and a note; confirm / neutral / dispute / withdraw buttons in the record drawer; the accepted value; the queues. Fifty specialist scientists will now use it, and the owner wants the surface reduced to what a contributor actually decides:

- On an existing record: **I agree** (validate) or **I have a different or additional value** (add a different record), the latter declaring whether the new value *contests* the old one (it is wrong) or *complements* it (both hold).
- On a new entry: the trait, the value from the controlled vocabulary, and where it comes from — one or more DOIs, or nothing, which means the scientist's own field work or expertise.

Everything stays append-only and attributed; no free text enters a value; every claim keeps a reference (RFC-63). The principle "every accepted value traces to a bibliographic source" is kept by making a personal observation a *reference of a special kind owned by the observer*, so the provenance chain has no holes.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Several references | One record per reference, in one transaction. The record model of RFC-63 (one claim = one reference) is untouched; reference counters, filters and the export keep working. |
| Personal observation | `bibliographic_references.kind = 'personal_observation'` with `observer_user_id`, one per user, created on first use; `citation_key = 'personal-observation:<user id>'`. Two scientists observing the same value are two claims; one repeating theirs is a duplicate (RFC-63 R3). Export prints "Personal observation" (no name, RFC-40). |
| DOI | Normalised (`10.` prefix, lowercase, `https://doi.org/` and `doi:` stripped). Existence: Handle API `https://doi.org/api/handles/<doi>` (JSON, no redirect). Metadata: `https://api.crossref.org/works/<doi>` (JSON; a 404 there means "not a Crossref DOI": the reference is created with the DOI alone). Two fixed hosts, `redirect: 'manual'`, 5 s timeout, injected client, fake in tests. A DOI-created reference has `citation_key = 'doi:<doi>'`. |
| Check vs create | `GET /api/references/resolve?doi=` answers `known` / `resolvable` / `not_found` without writing (the live indicator). `POST /api/records` resolves the DOIs it receives before its transaction and creates the missing references (audited), then inserts the records. |
| Intent | `trait_records.intent in ('contest', 'complement')` with `responds_to_record_id`; both or neither. The API refuses a response to a record of another species or trait, or to a withdrawn record. |
| Contest side effect | The service inserts one `dispute` annotation on the contested record by the same actor with the generated note `Contested by record <id>[, <id>…]`. Withdrawing a contest record inserts a `neutral` on the contested record when the actor's latest stance there is `dispute`. A complement inserts nothing on the older record. |
| Validation with a DOI | `record_annotations.reference_id` (null); `{ kind: 'confirm', reference?: { id } \| { doi } }` resolves the DOI as above. A supporting reference is optional, never required. |
| Reviewer permission | `records.review` gates `neutral` and `dispute` in `POST /api/records/:id/annotations`. `confirm` needs `records.annotate`; `withdraw` keeps RFC-65 R4. Contributors contest through `POST /api/records`, never through a bare dispute. |
| Response shape | `POST /api/records` answers 201 `{ created: RecordDetail[], duplicates: [{ recordId, referenceId }] }`; 409 `RECORD_DUPLICATE` only when nothing was created (every claim existed). The web app is the only client and is updated in 09b. |
| Form fields | Removed from the contributor forms: secondary reference, "as written in the source", note. The API keeps `secondaryReferenceId`, `rawValue`, `note` as optional inputs (the harmonisation mapping and future curator forms use them). |
| Missing traits | `GET /api/species/:id/traits?includeMissing=true` adds every visible active trait with no record as a zero-count entry, so the species page can show "traits with no data". |
| Trait descriptions | Already in the dictionary the web app loads; tooltips read from it. No API change. |

## 3. Data model (plan 09a; one generated migration + one custom permissions migration)

- `bibliographic_references`: `kind text not null default 'publication'` check in (`publication`, `personal_observation`); `observer_user_id uuid null references users`; check `(kind = 'personal_observation') = (observer_user_id is not null)`; unique partial index `bibliographic_references_observer_idx (observer_user_id) where kind = 'personal_observation'`; index `bibliographic_references_doi_lower_idx on (lower(doi)) where doi is not null` for the case-insensitive DOI lookup (the existing unique index on `doi` stays; RFC-80 normalises to lowercase on write, so new rows never collide by case).
- `trait_records`: `intent text null` check in (`contest`, `complement`); `responds_to_record_id uuid null references trait_records restrict`; check `(intent is null) = (responds_to_record_id is null)`; partial index `trait_records_responds_to_idx (responds_to_record_id) where responds_to_record_id is not null`; a trigger `trait_records_response_check` refuses a row whose `responds_to_record_id` names a record of another species or trait (same pattern as the accepted-values trigger of RFC-63 R7).
- `record_annotations`: `reference_id uuid null references bibliographic_references restrict`; check `reference_id is null or kind = 'confirm'`; `generated boolean not null default false` — true for the annotations the API writes as a side effect (contest dispute, contest-withdrawal neutral), so queues and the digest can tell a scientist's own stance from a generated one.
- Permissions migration: insert `records.review` and the `role_permissions` row for `manager` (RFC-31 R10).

The append-only triggers and revokes of `0012` stay; every new column is written on insert only.

## 4. References (RFC-61 amendments, plan 09a)

- **R1 amended.** Columns `kind`, `observer_user_id` as in section 3.
- **R7 (new).** Personal observation. `ensurePersonalObservation(db, userId)` returns the user's reference of kind `personal_observation`, inserting it on first use with `citation_key = 'personal-observation:' || user id`, `created_by = user`, audit `references.created` with `metadata: { kind: 'personal_observation' }`. The reference item carries `kind` and `observer: { id, name } | null` (decrypted like record actors, under `dataset.read`). `PATCH /api/references/:id` refuses a personal-observation reference (409 `REFERENCE_IS_PERSONAL`): its identity is the observer. The export (RFC-66) prints `Personal observation` in the reference columns for such references.
- **R4 amended.** `GET /api/references?kind=publication|personal_observation|all` (default `publication`); personal observations are listed only on request, so the references page stays a bibliography. The web app shows a personal-observation reference as "Personal observation (Name)" wherever a citation key is shown — `referenceLabel()` lands with plan 09b (personal-observation branch) and grows the short-citation branch in plan 10d.
- **R8 (new).** DOI-created references (RFC-80): `citation_key = 'doi:<normalised doi>'`, `doi` the normalised DOI, `url = 'https://doi.org/<doi>'`, and, when Crossref answers, `title`, `authors` (`Family, Given; Family, Given…`, at most 1,000 characters), `year` (`issued.date-parts[0][0]`), `journal` (`container-title[0]`). Audit `references.created` with `metadata: { source: 'doi' }`, `created_by` the actor.

## 5. DOI resolution (RFC-80, new; plan 09a)

Category integrations, file `docs/rfc/80-integrations/80-doi-resolution.md`.

- **R1** Normalisation `normaliseDoi(text)`: trim; strip a leading `https://doi.org/`, `http://doi.org/`, `https://dx.doi.org/`, `doi:` (case-insensitive); lowercase; the result must match `^10\.\d{4,9}/\S{1,200}$` else it is *malformed*. The normalised DOI is the stored and compared form.
- **R2** Lookup order for a DOI: (1) `bibliographic_references` where `lower(doi) = <doi>` → *known*; (2) the Handle API `GET https://doi.org/api/handles/<doi>` — `responseCode` 1 → *resolvable*, `100` or HTTP 404 → *not found*; (3) for a resolvable DOI, `GET https://api.crossref.org/works/<doi>` with header `User-Agent: TreeRepro/<version> (mailto:<support address from config>)` — 200 → metadata, 404 → no metadata, anything else → metadata unavailable (the reference is still created with the DOI alone).
- **R3** Transport: `fetch` with `redirect: 'manual'` (a 3xx is treated as a failure), `signal` timeout 5 s per call, at most one call per step, no retry. Hosts are the two literals above; the DOI is percent-encoded in the path. A network error or timeout on step 2 answers 502 `DOI_LOOKUP_FAILED`; on step 3 it degrades to "no metadata". The client is `ctx.doi` (`DoiClient` interface with `exists(doi)` and `metadata(doi)`); tests inject a fake and never reach the network.
- **R4** `GET /api/references/resolve?doi=` (`records.create`): malformed → 400 `VALIDATION_FAILED` (path `doi`, "Malformed DOI"); otherwise `{ status: 'known', reference } | { status: 'resolvable', reference: null, preview: { title, authors, year, journal } | null } | { status: 'not_found', reference: null }`. Rate limit 60 per minute per user (RFC-24 helper), 429 `RATE_LIMITED`.
- **R5** `resolveReferences(ctx, actor, sources)` — used by `POST /api/records` and `POST /api/records/:id/annotations` — takes `[{ id } | { doi }]`, answers reference ids in input order, creating DOI references per RFC-61 R8 outside the caller's transaction (each creation is its own statement + audit transaction; a creation that races another request lands on the `lower(doi)` collision and re-reads). Errors: unknown id → 404 `REFERENCE_NOT_FOUND`; malformed → 400 (path `references.<i>.doi`); not found → 400 `VALIDATION_FAILED` (path `references.<i>.doi`, "DOI does not resolve"); lookup failure → 502 `DOI_LOOKUP_FAILED`.
- **R6** `redirect: 'manual'`, fixed hosts and a 1 MiB response cap — enforced while streaming the body (`res.body.getReader()`, abort past the cap), never by buffering first — make the client immune to SSRF and response bombs; the support address in the User-Agent comes from configuration (`DOI_CONTACT_EMAIL`, optional; absent → no `mailto`), never from a user.

## 6. Contribution workflow (RFC-70, new; RFC-65 and RFC-63 amendments; plan 09a)

Category workspace, file `docs/rfc/70-workspace/70-contribution-workflow.md`.

- **R1** `POST /api/records` (`records.create`) body: `{ speciesId, traitId, value, sources, intent?, respondsToRecordId?, rawValue?, note?, secondaryReferenceId? }` where `sources` is `{ personalObservation: true }` or `{ references: [{ id } | { doi }] }` with 1–10 entries, distinct after normalisation. `value` is RFC-65 R1. `intent` and `respondsToRecordId` come together (400 `VALIDATION_FAILED`, path `intent`) or not at all. Visibility (RFC-33 R5) applies to species, trait and the responded record.
- **R2** Resolution: species, trait, value and level checks of RFC-65 R1; then `responds_to`: the record exists and is visible (404 `RECORD_NOT_FOUND`), belongs to the species and trait (400, path `respondsToRecordId`), is not withdrawn (409 `RECORD_WITHDRAWN`); for a `contest`, the new value must differ from the contested record's (`level_id` or `numeric_value`; 400 `VALIDATION_FAILED`, path `value`, "A contest carries a different value" — a complement may repeat the value under another reference); then the sources resolve to reference ids (RFC-80 R5; a personal observation resolves to RFC-61 R7).
- **R3** Insert, in one transaction: one record per reference id with `primary_reference_id` = that id and every other column identical (`origin = 'manual'`, `harmonisation = 'harmonised'`, `created_by = actor`, `intent`, `responds_to_record_id`, `raw_value`, `note`, `secondary_reference_id`), `ON CONFLICT ON CONSTRAINT trait_records_claim_key DO NOTHING`; the existing record id of each skipped claim is read back. When `intent = 'contest'` and at least one record was created, insert one `dispute` annotation on the responded record with `actor_id = actor`, `generated = true`, `note = 'Contested by record ' || ids joined by ', '`. Answer 201 `{ created: [detail…], duplicates: [{ recordId, referenceId }] }` (RFC-65 R1 amended); when nothing was created answer 409 `RECORD_DUPLICATE` with `details` listing `{ path: 'sources.references.<i>', message: <existing id> }` per source (RFC-65 R2 amended).
- **R4** `POST /api/records/:id/annotations` (RFC-65 R3 amended): `confirm` and `withdraw` need `records.annotate`; `neutral` and `dispute` need `records.review` in addition (403 `PERMISSION_DENIED`; the handler passes `canReview` to the service as it passes `canWithdrawAny`). `confirm` accepts `reference: { id } | { doi }` (optional) resolved per RFC-80 R5 and stored in `reference_id`; the annotation representation gains `reference: { id, citationKey, kind } | null` and `generated: boolean` (RFC-63 R8 amended).
- **R5** Withdrawing a record that has `intent = 'contest'` (RFC-65 R4 amended): after the `withdraw` annotation, when the responded record is not withdrawn and the actor's latest stance on it is `dispute`, insert `neutral` there with `generated = true`, `note = 'Contest withdrawn (record ' || id || ')'`, in the same transaction. Withdrawal of a complement has no side effect.
- **R6** Representations (RFC-63 R8 amended): the record item carries `intent: 'contest' | 'complement' | null` and `respondsTo: { id } | null`; the detail adds `responses: [{ id, intent, createdBy, createdAt }]` (records naming this one, newest first). The reference ref (`{ id, citationKey }`) gains `kind`.
- **R7** `GET /api/species/:id/traits?includeMissing=true` (RFC-63 R10 amended): with the flag, the response also lists every visible active trait with no visible record for the species, as `{ trait, recordCount: 0, harmonisationCounts: all zero, levels: null, numeric: null, accepted: null }`, in dictionary order; categories that only have missing traits appear. Without the flag the response is as today.
- **R8** Audit: none for records and annotations (RFC-65 R12); reference creation audits per RFC-61 R7–R8.

Error codes (RFC-12): `DOI_LOOKUP_FAILED` 502 "The DOI registry could not be reached"; `REFERENCE_IS_PERSONAL` 409. Permissions (RFC-30): `records.review` "Neutralise or dispute any record with a note".

## 7. Web (plan 09b)

### 7.1 Record actions (`RecordActions`)

For a viewer with `records.annotate`, on a record that is not withdrawn:

| Button | Style | Action |
|---|---|---|
| **✓ Validate** | primary, green tone | Posts `confirm`. A small disclosure "Add a supporting DOI (optional)" opens a `DoiField`; when filled and resolvable, the DOI goes with the annotation. Disabled with the hint "You validated this record" when the viewer's latest stance is `confirm`. |
| **+ Add different record** | danger tone (red outline) | Opens `ContestDialog` (7.2). |

Both carry a `title` tooltip and a `HelpTip` (`?`) with the long explanation (section 7.5). With `records.review`: Neutral and Dispute (note form) as today, after the two main buttons. Withdraw and Set as accepted as today. A record with `intent` shows a badge "contests record …" / "complements record …" linking to the responded record; a contested record lists its responses in a new drawer section "Responses".

### 7.2 Contest dialog (`ContestDialog`)

Two steps in one dialog, titled "Add a different record for *trait* of *species*":

1. **What does your value mean?** Radio group, nothing preselected: **Contest** — "The existing value is wrong; mine should replace it." / **Complement** — "The existing value is also correct; I am adding another observation." Each with an example line. Every field of step 2 stays disabled until one is chosen.
2. **Your record.** The value control (level select from active levels, or number with unit), the `SourcesField` (7.4), the attribution line "Recorded as *Your name*". Submit **Add record**. The API answer opens the first created record in the drawer; `duplicates` show as an alert "One of these claims already existed" with links.

### 7.3 Add entries for another trait (`AddEntriesDialog`, replaces `AddValueDialog`)

Header button renamed **Add entries for another trait**. Fields, in order: **Broad trait category** (select over the dictionary categories that have at least one active trait); **Trait** (select filtered by the category; disabled until a category is chosen; shows the unit); the value control; `SourcesField`; the attribution line. When opened from a trait card the category and trait are fixed. Categories, traits and levels come from `GET /api/traits` (already visible-filtered by RFC-33). No secondary reference, no "as written", no note.

### 7.4 Sources field (`SourcesField`, `DoiField`)

One `DoiField` by default with the hint "Leave blank if this comes from your own field work or expert knowledge; otherwise give the DOI." and a `HelpTip`. **Add another reference** appends a `DoiField` (up to 10); each row carries a remove button while more than one row is shown — the field always shows at least one row, so a lone row is cleared by emptying it rather than removed. On blur, a non-empty field calls `GET /api/references/resolve?doi=` (debounced, one request per value) and shows: ✅ "Resolved: *title (year)*" (`known` or `resolvable`), ❌ "DOI not found" (blocks submit), ⚠ "Malformed DOI" (blocks submit), ⚠ "Could not check the DOI — try again" (blocks submit, the API would refuse anyway). Every field empty → the form submits `{ personalObservation: true }` and the line "This will be recorded as your personal observation" shows above the submit button. A mix of empty and filled fields submits the filled ones only.

### 7.5 Help tips (`HelpTip`)

A `?` button (`aria-label="What does this mean?"`) that opens a small popover on click (and on hover / focus) with the text passed as children; closes on Escape and outside click; rendered without inline styles (Tailwind classes; positioned with CSS anchor fallback: below the trigger). Used for: the two record buttons, the DOI hint, each trait row on the species page (description from the dictionary, with the unit for quantitative traits), the trait selects of the forms.

### 7.6 Species page

- Toggle **Show traits with no data** (checkbox in the page header, URL search `missing=true`) → `includeMissing=true`. A zero-count trait renders as an `EmptyTraitCard`: name, `HelpTip`, "No records yet", and **Add the first entry** (opens `AddEntriesDialog` with the trait fixed) for `records.create`.
- Every `TraitCard` shows the `HelpTip` with the trait description.
- The header button reads "Add entries for another trait".

### 7.7 Errors

Mapped sentences (RFC-13 R6): `DOI_LOOKUP_FAILED` → "The DOI registry could not be reached. Try again in a moment."; `RECORD_DUPLICATE` → "Every reference already supports this exact claim. Validate the existing record instead."; `RECORD_WITHDRAWN` on contest → "This record is withdrawn; it cannot be contested."; validation details land under the DOI row named by the path (`sources.references.<i>.doi`).

## 8. Testing

- Unit: `normaliseDoi` (property test with `fast-check` over prefixes and case), the citation-key derivation, the Crossref metadata mapping (fixture JSON), the generated notes.
- Integration (API): personal-observation reference is created once per user and reused; DOI resolve statuses with the fake client (known / resolvable / not found / failure / metadata 404); `POST /api/records` with N references creates N records and answers duplicates; contest inserts the dispute with the generated note and refuses cross-species / withdrawn targets; withdrawal of a contest inserts the neutral; `records.review` gate; confirm with a DOI stores `reference_id`; `includeMissing` lists zero-count traits and respects visibility; the route-guard meta-test list is updated.
- Web: `RecordActions` by permission and by stance; `ContestDialog` step gating and submission bodies; `AddEntriesDialog` cascade and personal-observation line; `DoiField` states with mocked API; `HelpTip` accessibility; species page missing toggle.
- E2E: a contributor validates a record, contests one with a personal observation, adds an entry for a trait without data.

## 9. Out of scope

Contributor-facing dispute notes; editing a reference's metadata by contributors; DataCite metadata (DOI-only reference until an admin fills it); ORCID; batch validation of many records at once.

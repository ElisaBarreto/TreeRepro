# TreeRepro — Record Model Revision (plans 13a–13j)

**Date:** 2026-09-25
**Status:** approved design; nothing implemented yet
**Amendments:** 2026-09-25 — owner ruling: a contest states the correct levels; its levels that already have records become validations, its new levels become contest records, and every other existing level is contested (named in the request as `contestedLevelIds`, checked by the API). A contest is stored even when it creates no record, its contested set is fixed at submission, and the entry dialog shows a per-level confirmation summary before submit when the trait already has levels with records (R-7–R-10, R-17, R-20, §2, §6). A contest stands only while something it contests has a visible record, and E holds active levels only (R-8, R-9). 2026-09-25 — owner ruling: records of a deactivated level, and contests naming one, are visible only to holders of `dataset.read_inactive` (R-14). 2026-09-26 — plan 13k: the total `--replace` is also refused once an annotation or a contest exists, not only a `TR_` record, and complements and harmonisations of `EB_` records are sheet rows re-linked like quantitative contests (R-20; RFC-64 R12, R15 are authoritative).
**Scope:** the owner's change list of 2026-09-25: the home page, adding and annotating records, contests, the end of the accepted value, withdrawal, book references, quantitative summaries, record IDs, the full export and the help pages. Every decision below was confirmed with the owner on 2026-09-25.

This file is both the index and the design. Each issue has its own implementation plan under `docs/plans/2026-09-25-revision-<NN><letter>-<slug>.md`.

## 1. Business rules (the target state)

These rules are what plan 13a writes into the RFCs. Every other plan codes against them.

### 1.1 Records

- **R-1 No accepted value.** The platform stores every claim and never picks one. Removed: `accepted_values`, `GET|PUT /api/species/:id/traits/:traitId/accepted`, **Set as accepted**, `AcceptedSection`, the `accepted` line and badge, and the permission `accepted.manage`. Wherever a screen counted "accepted", it counts **validated** instead: a species × trait is validated when at least one of its visible records has a validation.
- **R-2 Record ID.** Every record has `record_code`: text, unique, not null. An imported record takes the value of the file's `ID` column, which must match `^EB_[0-9]+$`; a missing, malformed or repeated ID rejects the row. A record created on the platform gets `'TR_' || nextval('record_code_tr_seq')` from the database. Gaps in the `TR_` sequence are accepted. **Split entries get letter suffixes:** an import row split into several levels (`a;b`, RFC-64 R6) gives `EB_1a`, `EB_1b`, …; a platform form with several levels takes one sequence number and gives `TR_7a`, `TR_7b`, …; a single-level entry keeps the bare code (`EB_1`, `TR_5`). Suffixes run a–z, then aa, ab, … Stored codes match `^(EB|TR)_[0-9]+([a-z]+)?$`.
- **R-3 Categorical value.** One level per record. A form with several levels creates **one record per level**.
- **R-4 Several references, one record.** All the references given in a form belong to each record it creates. The first goes to `primary_reference_id` as today; the rest go to `record_references (record_id, reference_id)`. Imported records do not use `record_references`. Screens and the export list a record's references joined by `; `. The reference counters and `reference_traits` count `record_references` rows as usages.
- **R-5 Quantitative value.** `numeric_value` is the **single value**. The new nullable columns are `min_value`, `max_value`, `mean_value`, `sd_value` and `n`. At least one of single, min, max and mean is required. Also `min_value ≤ max_value`, `sd_value ≥ 0` and `n` is an integer ≥ 1. The import fills only the single value. The trait card summary shows the smallest value found across the species' records (over single, min, max and mean), the largest, and the mean of each record's single value, or its mean when it has no single value.

### 1.2 Validation

- **R-6 Validate** writes a `confirm` annotation, with an optional supporting reference (DOI or ISBN). A user cannot validate their own record. Each user counts once per record. A validation cannot be undone.
- **R-7 Duplicate means validation.** When a new entry matches a visible record of the same species and trait, no record is created. A categorical entry matches on the same level; a quantitative entry matches when all six fields are identical. The user's references become validations of the existing record, one `confirm` per reference, or a single `confirm` without a reference. The response names the record as "matches an existing record — counted as your validation". If the matching record is the user's own, the response only reports the duplicate. When a form mixes new and matching levels, the new levels create records and the matching ones become validations. Matching is the same for every intent; a contest adds one step (R-8): the existing levels it does not give are the levels it contests.

### 1.3 Contest

- **R-8 Contest states the correct levels.** A categorical contest states which levels are correct. Let E be the active levels that have a visible record for the species and trait when it is submitted, and S the levels it gives (at least one). The levels of S ∩ E become the user's validations (R-6, R-7: one `confirm` per reference, own records only reported as duplicates) and create no record; the levels of S \ E create records with `intent = 'contest'`; the levels of E \ S are **contested** by it. Example: a flower is blue, yellow and red; a contest giving only red validates red and contests blue and yellow; one giving only green creates a green record and contests all three. The request names the contested levels (`contestedLevelIds`); the API recomputes E \ S and answers 400 `VALIDATION_FAILED` with path `contestedLevelIds` unless they are equal, and with path `intent` ("A contest must contest at least one level; this is a complement") when E \ S is empty. The contest is stored even when it creates no record (the storage is plan 13g's), and its contested set is fixed at submission: a level that first appears later is not contested by it. `respondsToRecordId` no longer defines a categorical contest; a complement may still respond to a record. A quantitative contest is unchanged: one record that responds to one record, contests it, and must differ from it in at least one of the six fields.
- **R-9 Contested.** A contest is *standing* while it is not withdrawn, carries no Keep both, and at least one level it names (or the quantitative record it responds to) still has a visible record; a level emptied by Withdraw level that later gets a visible record again is contested again by a contest that is still standing. A level is contested while a standing contest names it and the level still has a visible record; a quantitative record is contested while a standing contest responds to it. A species × trait is contested when one of its levels or records is. **Contested is the only status** in the platform, and every viewer sees it.
- **R-10 Resolve.** Resolving requires `records.review` (manager or admin), in one of two ways:
  - withdraw one side: the contest (**Withdraw contest**: its records, or the contest itself when it created none), or a contested level through **Withdraw level**, which withdraws every record of that level the actor may withdraw;
  - or **Keep both**, a `resolve` on the contest, which clears every level it names.

  A level's flag clears once no standing contest names it, or once the level has no visible record left. A manager's Withdraw level cannot remove imported records (R-12), for example; when records remain that the actor cannot withdraw, the page names them as such and offers Keep both or an admin's withdrawal.
- **R-11 Neutral and Dispute are removed** from the API and the UI. The contested flag is derived from contests, not from `dispute` annotations. Old `dispute` and `neutral` rows stay in the table and are ignored.

### 1.4 Withdrawal

- **R-12** Withdrawal has no note: the UI shows only a confirmation dialog. Who may withdraw what:
  - the author, their own records;
  - `records.withdraw` (manager and admin), any manual record;
  - the new permission `records.withdraw_imported` (admin only), imported records.
- **R-13 A withdrawn record leaves the dataset.** It disappears from lists, counts, cards, coverage, filters, queues, contributions and the export, for every viewer, strikethrough included. It stays in the database for audit only. The counters `species_trait_coverage`, `species.trait_count`, the reference usage counts and `reference_traits` **decrement** on withdrawal (today they only grow).

### 1.5 Visibility and filters

- **R-14** Records whose harmonisation is not `harmonised` (unknown levels and the like) and the **unresolved** taxon badge are visible only to holders of `records.review`. Records of a deactivated level, and contests naming one, are visible only to holders of `dataset.read_inactive` (owner ruling 2026-09-25).
- **R-15** Species list filters:
  - **Contested**, for everyone;
  - **Has unknown levels**, for `records.review`;
  - **Unresolved**, for `records.review` (it exists already).

### 1.6 References

- **R-16** Reference kinds are `publication` (DOI), `book` and `personal_observation`. A `book` reference has:
  - `isbn`: an ISBN-10 or ISBN-13 with a valid check digit, normalised to ISBN-13 digits, unique;
  - a required citation text (authors, year, title).

  There is no external lookup. The ISSN is not supported.

### 1.7 Export

- **R-17** `GET /api/export/dataset.zip` requires `dataset.export` (admin), is audited and streamed, and replaces `accepted.csv`. It contains two files:
  - `records.csv`: every visible, non-withdrawn record, pending ones included (with their raw value). Columns:

    ```
    record_code, family, genus, species, name_source, category, trait, unit, level,
    value_single, value_min, value_max, value_mean, value_sd, value_n, raw_value,
    references, origin, intent, responds_to, contested, n_validations, n_contests,
    created_at
    ```

    `n_validations` and `n_contests` count distinct users. `references` is the `; `-joined list.
  - `annotations.csv`: one row per validation and per contest: `record_code, kind (validation|contest), user_name, date, reference, contest_record_code`. User names only, never e-mail addresses. A contest (not withdrawn, resolved included) gives one row per visible record it contests — every visible record of each level it names, or the one record a quantitative contest responds to — with that record's code in `record_code` and the codes of the records the contest created, joined by `; `, in `contest_record_code` (empty when it created none).

### 1.7b Imports after the test phase

- **R-19 Incremental import.** Later imports add records with new `EB_n` IDs. A row whose `ID` already exists in the database is skipped and counted as `already imported` in the report (not a reject), so a full file with old and new rows can be sent again.
- **R-20 Replace that preserves the platform.** `import:records --replace-imported` replaces the imported (`EB_`) records and keeps everything users produced. In one transaction:
  1. write the **annotation sheet** `replace-<batch>-annotations.csv`: every validation, contest, resolve and withdrawal on an `EB_` record, and every quantitative `TR_` contest responding to an `EB_` record (`record_code, kind, user_name, date, reference, contest_record_code`); a categorical contest names levels, not records, so the replace leaves it untouched, and it contests a level again once the new file gives that level a visible record;
  2. delete the `EB_` records and their annotations only (species, genera, families, references, plots, plot species, user plots, synonyms, proposals and every `TR_` record stay; the file adds what is missing);
  3. import the new file;
  4. **re-link by `record_code`**: annotations and quantitative `TR_` contests pointing to an `EB_n` present in the new file are attached to the new record; the ones whose `EB_n` is gone are marked `orphan` in the sheet and dropped, and an orphaned `TR_` contest becomes an independent record (intent and target cleared);
  5. recompute the counters (`species_trait_coverage`, `species.trait_count`, reference usage counts, `reference_traits`).

  Runs as `treerepro_migrator` through the runbook's one-off container, production included, after a `pg_dump`. The old total `--replace` (RFC-64 R12) is refused whenever a `TR_` record exists — it is for the test phase only.
- **R-21 Platform-only export.** `GET /api/export/dataset.zip?scope=platform` gives `records.csv` with the `TR_` records only and `annotations.csv` with every validation and contest made by users (on `TR_` and `EB_` records). No scheduled copy: the daily encrypted backup already holds everything.

### 1.8 Home page

- **R-18** The intro text takes the full width of its card and reads, with live numbers:

  > TreeRepro is a collective data assembly of reproductive trait data for trees, covering traits across all reproductive stages — flower, fruits, and seeds. Its core data comes from open-source papers and data repositories spanning {primary} primary references, {secondary} secondary references and {records} records over {species} species. It is shared here with a community of specialists to fill gaps and validate existing records. For questions, contact elisabpereira@gmail.com.

  `{primary}` and `{secondary}` count references with `primary_count > 0` and with `secondary_count > 0`. The buttons below the text are **Browse species**, **Browse traits** and **Browse references**. The "Top traits missing data" list becomes **Top traits with data**: the ten traits with the most species with data (`speciesCountsByTrait`), each linking to `/app/traits/$id`. The Getting started card loses its opening sentence.

## 2. Screens (species page)

- A legend at the top of the page: 👍 **Validate** · 👎 **Contest** · ＋ **Complement**. The symbols are drawn as `Icon` stroke glyphs (`thumbsUp`, `thumbsDown`, `plus` in `components/ui/Icon.tsx`), never emoji (workspace UI pattern: "No emoji"); the emoji in this spec are shorthand.
- A categorical trait card lists **every** level the species has (the cap of 5 bars goes). Each level has 👍 👎 ＋.
  - 👍 opens "Do you confirm that this record is correct?" with an optional supporting reference, then validates every record of that level (R-6).
  - 👎 opens the entry dialog with **Contest** chosen, that level unchecked and every other level with records checked; the user adjusts. ＋ opens the entry dialog.
- A quantitative trait has the same three buttons on each row of the record panel.
- **Entry dialog.** When the species already has records for the trait, the first step is a required choice between **Contest** and **Complement**. Every other field and the submit button stay disabled until the user answers. This applies from the card's ＋ as well (2.1). Level selection is multiple (checkboxes). Before submit, a categorical entry on a trait that already has levels with records (E not empty, R-8) shows a **confirmation summary** of what it will do per level — "Validate red · Contest blue, yellow · Add green" — and the user must confirm it (a first entry on a trait with no records has nothing to validate or contest and needs none); the request sends the contested levels as `contestedLevelIds` (R-8). A quantitative trait gets the six fields. Sources accept a DOI, an ISBN with its citation, or neither (personal observation).
- **Record panel.** Columns are sortable with a server-side `sort` parameter, validated against the list of sortable columns: value, references, origin, added. A counts column shows ✓ n / ✗ n and a **Contested** badge. Withdrawn records are not shown.
- The `?` trait tip is larger.

## 3. Issues, order, files

| Plan | Items | Scope | Main files | Needs |
|---|---|---|---|---|
| **13a** rules | all | RFC amendments for R-1…R-18: RFC-31, 61, 63, 64, 65, 66, 69, 70, 71, 72, 73, 80. Docs only. | `docs/rfc/**` | — |
| **13b** home | 1.1, 1.2, 1.4, 1.3 (sentence) | R-18 | `components/workspace/*`, `content/project.ts`, `api workspace/dashboard.ts`, `contracts dashboard.ts` | 13a |
| **13c** help tip | 8 | bigger `?` | `components/ui/HelpTip.tsx` | — |
| **13d** book references | 7 | R-16 | `db/schema/references.ts`, `dataset/sources.ts`, `contracts curation.ts` (sources schema only), `SourcesField`, `DoiField`, `ReferencesPage` | 13a |
| **13e** no accepted | 4 | R-1; interim export of all records | `dataset/curation.ts` (accepted block), `coverage.ts`, `trait-page.ts`, `contributions.ts`, `export.ts`, `summary.ts` (accepted part), `AcceptedSection`, `TraitCard` | 13a |
| **13f** record schema | IDs, 13 | R-2, R-4, R-5; the import reads `ID`; **reimport runbook** | `db/schema/records.ts`, `dataset/import.ts`, `summary.ts` (numeric part), `contracts` (value schema) | 13a |
| **13g** contest & withdrawal | 2.2, 3, 6, 9, 10, 11 | R-3, R-6…R-15; Contested queue (Keep both, Withdraw contest, Withdraw level) | `dataset/curation.ts` (annotations), `records.ts`, `queues.ts`, `taxa.ts` (filters), counter triggers, `DisputedPage`, species filters | 13e, 13f |
| **13h** species page | 2.1, 2.3, 2.4, 2.6 | §2 | `TraitCard`, `TraitPanel`, `RecordTable`, `ui/Table`, `RecordActions`, `AddEntriesDialog`, `ContestDialog`, `ValueField` | 13g, 13d |
| **13i** full export | 5, 12 | R-17 | `dataset/export.ts`, export route, the link on the species search | 13g |
| **13k** preserving reimport | R-20 | `--replace-imported`, annotation sheet, re-link by code, counter recompute, runbook | `dataset/import.ts` (+ a new `dataset/replace-imported.ts`), import CLI, RFC-64 | 13f, 13g, 13i |
| **13j** help pages | 1.3 | Text from `data/text for pages/Text for help me pages.docx`, tightened, describing the final behaviour | `content/help/*` | 13h |

```
13a ─┬─▶ 13b
     ├─▶ 13d ───────────────┐
     ├─▶ 13e ─┐             ▼
     └─▶ 13f ─┴─▶ 13g ─┬─▶ 13h ─▶ 13j
                       └─▶ 13i ─▶ 13k
13c (anytime)
```

**Waves:**

| Wave | Plans | Parallel |
|---|---|---|
| 0 | 13a | 1 |
| 1 | 13b, 13c, 13d, 13e, 13f | 5 |
| 2 | 13g | 1 |
| 3 | 13h, 13i | 2 |
| 4 | 13j, 13k | 2 |

## 4. Collision points

| Where | Who | Handling |
|---|---|---|
| `packages/contracts/src/curation.ts` | 13d (sources), 13f (value), 13g (annotations) | Different blocks of the file; a conflict shows as a marker. |
| Migrations | 13d, 13e, 13f, 13g | Numbered at merge time; whoever merges second renumbers and re-chains the snapshot `prevId`. |
| Permission catalog | 13e (removes `accepted.manage`), 13g (adds `records.withdraw_imported`) | Run the whole web suite: the `RoleDialog` test hardcodes the group order. |
| `apps/api/src/dataset/summary.ts` | 13e (accepted), 13f (numeric) | Different functions. |
| `apps/api/src/dataset/curation.ts` | 13e (accepted block), 13g (the rest) | 13g starts after 13e merges. |

## 5. Decisions and deliberate cuts

- **Reimport (this test phase only).** When the new source file with `ID` arrives, the imported records are replaced through the total replacing import of RFC-64 R12 — acceptable only now, while no user data exists. After this phase, reimports use `--replace-imported` (R-20, plan 13k) and the total replace is refused once any `TR_` record exists. The runbook in 13f stops unless manual records, annotations and `record_references` are all zero, and takes a `pg_dump` first. `accepted_values` is dropped without keeping its rows (the owner confirmed it holds no real data).
- **ZIP.** The API has no ZIP library, and `records.csv` can reach about 2 GB. 13i adds one small streaming ZIP dependency with ZIP64 support (candidate: `yazl`), pinned exact.
- **Cut:** undoing a validation, reverting a resolution, migrating old `dispute`/`neutral` rows, and ISSN. Add when asked.

## 6. Shared interfaces (fixed names — every plan uses these exactly)

Plans run in parallel; these names are the contract between them. A plan that needs to deviate amends this section first.

| Owner | Name | Shape |
|---|---|---|
| 13f | `trait_records.record_code` | `text not null unique`; manual default `'TR_' \|\| nextval('record_code_tr_seq')` |
| 13f | `nextRecordCodes(tx, count): Promise<string[]>` | one `nextval('record_code_tr_seq')`; `['TR_7']` for 1, `['TR_7a','TR_7b',…]` for more; 13g's create path calls it with the number of records actually created |
| 13f | `trait_records.min_value`, `max_value`, `mean_value`, `sd_value` | `numeric`, nullable; `numeric_value` stays and means *single* |
| 13f | `trait_records.n` | `integer`, nullable, `>= 1` |
| 13f | `record_references` | `(record_id uuid → trait_records, reference_id uuid → bibliographic_references)`, PK on both |
| 13f | contracts `quantitativeValueSchema` | `{ single?, min?, max?, mean?, sd?, n? }` (numbers; `n` int ≥ 1); at least one of single/min/max/mean; `min ≤ max`; `sd ≥ 0` |
| 13f | manual record value (contracts) | `{ levelIds: uuid[] (1–20) } \| { quantitative: QuantitativeValue }` — 13f replaces `{ numeric }` with `{ quantitative }`; 13g replaces `{ levelId }` with `{ levelIds }` |
| 13f | trait summary `numeric` | `{ min, max, mean: number \| null, count } \| null` (replaces `{ min, median, max, count }`; `mean` is null when no record has a single value or a mean) |
| 13f | record item | gains `recordCode`, `quantitative: QuantitativeValue \| null`, `references: ReferenceSummary[]` (primary first, then `record_references`) |
| 13d | `bibliographic_references.isbn` | `text` unique, 13 digits; `kind` gains `'book'` |
| 13d | source input (contracts) | `{ personalObservation: true } \| { references: SourceRef[] }` (1–10), `SourceRef = { id } \| { doi } \| { isbn, citation }` — the existing wrapper is kept |
| 13d | `isValidIsbn(input): string \| null` | in `packages/contracts` — returns normalised ISBN-13 or null |
| 13e | trait summary / trait page / coverage | `accepted*` fields removed; `validated` / `validatedCount` / `percentValidated` added; coverage `/top?mode=missing\|least_validated` |
| 13e, 13i | export | 13e: `GET /api/export/records.csv` (interim, all visible non-withdrawn records); 13i replaces it with `GET /api/export/dataset.zip` |
| 13g | create body | `POST /api/records` `{ speciesId, traitId, value, sources, intent?, respondsToRecordId?, contestedLevelIds?, rawValue?, note?, secondaryReferenceId? }`; a categorical contest sends `contestedLevelIds` (= E \ S, R-8) and no `respondsToRecordId`; a complement or a quantitative contest sends `respondsToRecordId` |
| 13g | annotations | `POST /api/records/:id/annotations` body `{ kind: 'confirm', referenceSource? } \| { kind: 'withdraw' }` (no `note`; `neutral`/`dispute`/`resolve` → 400) |
| 13g | contest actions | `POST /api/contests/:id/resolve` (`records.review`, Keep both) and `POST /api/contests/:id/withdraw` (author or `records.withdraw`), both 200 `{ data: null }` (RFC-65 R16) |
| 13g | contested queue item | `{ id, species, trait, createdBy, createdAt, levels: [{ levelId, key, contested }] \| null, target: RecordItem \| null, records: RecordItem[] }` (RFC-65 R10) |
| 13g | level actions | `POST /api/species/:id/traits/:traitId/levels/:levelId/validate` body `{ referenceSource? }`; `POST …/levels/:levelId/withdraw` (`records.review`) |
| 13g | create response | `{ created: RecordItem[], validated: [{ recordId, recordCode }], duplicates: [{ recordId, recordCode }] }` |
| 13g | record item counts | `validationCount`, `contestCount` (distinct users), `contested: boolean` |
| 13g | trait summary levels | `[{ levelId, key, count, validationCount, contested }]` (all levels, no cap); trait gains `contested: boolean` |
| 13g | species list filters | `contested=true` (all), `unknownLevels=true` and `unresolved=true` (`records.review`) |
| 13g | permission | `records.withdraw_imported` (admin only) |
| 13g | records list sort | `GET /api/records?…&sort=value\|references\|origin\|added&order=asc\|desc` (default `added desc`) |
| 13b | dashboard contract | `dataset.primaryReferenceCount`, `dataset.secondaryReferenceCount`; `contributor.topTraitsWithData: [{ trait, category, speciesCount }]` replaces `topMissingTraits` |

# TreeRepro — Record Model Revision (plans 13a–13j)

**Date:** 2026-09-25
**Status:** approved design; nothing implemented yet
**Scope:** the owner's change list of 2026-09-25: the home page, adding and annotating records, contests, the end of the accepted value, withdrawal, book references, quantitative summaries, record IDs, the full export and the help pages. Every decision below was confirmed with the owner on 2026-09-25.

This file is both the index and the design. Each issue has its own implementation plan under `docs/plans/2026-09-25-revision-<NN><letter>-<slug>.md`.

## 1. Business rules (the target state)

These rules are what plan 13a writes into the RFCs. Every other plan codes against them.

### 1.1 Records

- **R-1 No accepted value.** The platform stores every claim and never picks one. Removed: `accepted_values`, `GET|PUT /api/species/:id/traits/:traitId/accepted`, **Set as accepted**, `AcceptedSection`, the `accepted` line and badge, and the permission `accepted.manage`. Wherever a screen counted "accepted", it counts **validated** instead: a species × trait is validated when at least one of its visible records has a validation.
- **R-2 Record ID.** Every record has `record_code`: text, unique, not null. An imported record takes the value of the file's `ID` column, which must match `^EB_[0-9]+$`; a missing, malformed or repeated ID rejects the row. A record created on the platform gets `'TR_' || nextval('record_code_tr_seq')` from the database. Gaps in the `TR_` sequence are accepted.
- **R-3 Categorical value.** One level per record. A form with several levels creates **one record per level**.
- **R-4 Several references, one record.** All the references given in a form belong to each record it creates. The first goes to `primary_reference_id` as today; the rest go to `record_references (record_id, reference_id)`. Imported records do not use `record_references`. Screens and the export list a record's references joined by `; `. The reference counters and `reference_traits` count `record_references` rows as usages.
- **R-5 Quantitative value.** `numeric_value` is the **single value**. The new nullable columns are `min_value`, `max_value`, `mean_value`, `sd_value` and `n`. At least one of single, min, max and mean is required. Also `min_value ≤ max_value`, `sd_value ≥ 0` and `n` is an integer ≥ 1. The import fills only the single value. The trait card summary shows the smallest value found across the species' records (over single, min, max and mean), the largest, and the mean of each record's single value, or its mean when it has no single value.

### 1.2 Validation

- **R-6 Validate** writes a `confirm` annotation, with an optional supporting reference (DOI or ISBN). A user cannot validate their own record. Each user counts once per record. A validation cannot be undone.
- **R-7 Duplicate means validation.** When a new entry matches a visible record of the same species and trait, no record is created. A categorical entry matches on the same level; a quantitative entry matches when all six fields are identical. The user's references become validations of the existing record, one `confirm` per reference, or a single `confirm` without a reference. The response names the record as "matches an existing record — counted as your validation". If the matching record is the user's own, the response only reports the duplicate. When a form mixes new and matching levels, the new levels create records and the matching ones become validations.

### 1.3 Contest

- **R-8 Contest a level.** A contest is a new record with `intent = 'contest'` whose value differs from the level it contests. It **carries a value**; a contest without one does not exist. `responds_to_record_id` points to one record of the contested level, and the contest applies to **every** record of that level for the species and trait. Contesting "blue" in {red, blue, orange} touches only blue. A quantitative contest responds to one record.
- **R-9 Contested.** A level (or a quantitative record) is contested while a contest responding to it is neither withdrawn nor resolved. A species × trait is contested when one of its levels or records is. **Contested is the only status** in the platform, and every viewer sees it.
- **R-10 Resolve.** Resolving requires `records.review` (manager or admin), in one of two ways:
  - withdraw one side: the contest record, or the contested level through **Withdraw level**, which withdraws every record of that level the actor may withdraw;
  - or **Keep both**, which writes a `resolve` annotation on the contest record.

  Either way the flag clears.
- **R-11 Neutral and Dispute are removed** from the API and the UI. The contested flag is derived from contest records, not from `dispute` annotations. Old `dispute` and `neutral` rows stay in the table and are ignored.

### 1.4 Withdrawal

- **R-12** Withdrawal has no note: the UI shows only a confirmation dialog. Who may withdraw what:
  - the author, their own records;
  - `records.withdraw` (manager and admin), any manual record;
  - the new permission `records.withdraw_imported` (admin only), imported records.
- **R-13 A withdrawn record leaves the dataset.** It disappears from lists, counts, cards, coverage, filters, queues, contributions and the export, for every viewer, strikethrough included. It stays in the database for audit only. The counters `species_trait_coverage`, `species.trait_count`, the reference usage counts and `reference_traits` **decrement** on withdrawal (today they only grow).

### 1.5 Visibility and filters

- **R-14** Records whose harmonisation is not `harmonised` (unknown levels and the like) and the **unresolved** taxon badge are visible only to holders of `records.review`.
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
  - `annotations.csv`: one row per validation and per contest: `record_code, kind (validation|contest), user_name, date, reference, contest_record_code`. User names only, never e-mail addresses.

### 1.8 Home page

- **R-18** The intro text takes the full width of its card and reads, with live numbers:

  > TreeRepro is a collective data assembly of reproductive trait data for trees, covering traits across all reproductive stages — flower, fruits, and seeds. Its core data comes from open-source papers and data repositories spanning {primary} primary references, {secondary} secondary references and {records} records over {species} species. It is shared here with a community of specialists to fill gaps and validate existing records. For questions, contact elisabpereira@gmail.com.

  `{primary}` and `{secondary}` count references with `primary_count > 0` and with `secondary_count > 0`. The buttons below the text are **Browse species**, **Browse traits** and **Browse references**. The "Top traits missing data" list becomes **Top traits with data**: the ten traits with the most species with data (`speciesCountsByTrait`), each linking to `/app/traits/$id`. The Getting started card loses its opening sentence.

## 2. Screens (species page)

- A legend at the top of the page: 👍 **Validate** · 👎 **Contest** · ＋ **Complement**.
- A categorical trait card lists **every** level the species has (the cap of 5 bars goes). Each level has 👍 👎 ＋.
  - 👍 opens "Do you confirm that this record is correct?" with an optional supporting reference, then validates every record of that level (R-6).
  - 👎 and ＋ open the entry dialog.
- A quantitative trait has the same three buttons on each row of the record panel.
- **Entry dialog.** When the species already has records for the trait, the first step is a required choice between **Contest** and **Complement**. Every other field and the submit button stay disabled until the user answers. This applies from the card's ＋ as well (2.1). Level selection is multiple (checkboxes). A quantitative trait gets the six fields. Sources accept a DOI, an ISBN with its citation, or neither (personal observation).
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
| **13g** contest & withdrawal | 2.2, 3, 6, 9, 10, 11 | R-3, R-6…R-15; Disputed page (Keep both, Withdraw level) | `dataset/curation.ts` (annotations), `records.ts`, `queues.ts`, `taxa.ts` (filters), counter triggers, `DisputedPage`, species filters | 13e, 13f |
| **13h** species page | 2.1, 2.3, 2.4, 2.6 | §2 | `TraitCard`, `TraitPanel`, `RecordTable`, `ui/Table`, `RecordActions`, `AddEntriesDialog`, `ContestDialog`, `ValueField` | 13g, 13d |
| **13i** full export | 5, 12 | R-17 | `dataset/export.ts`, export route, the link on the species search | 13g |
| **13j** help pages | 1.3 | Text from `data/text for pages/Text for help me pages.docx`, tightened, describing the final behaviour | `content/help/*` | 13h |

```
13a ─┬─▶ 13b
     ├─▶ 13d ───────────────┐
     ├─▶ 13e ─┐             ▼
     └─▶ 13f ─┴─▶ 13g ─┬─▶ 13h ─▶ 13j
                       └─▶ 13i
13c (anytime)
```

**Waves:**

| Wave | Plans | Parallel |
|---|---|---|
| 0 | 13a | 1 |
| 1 | 13b, 13c, 13d, 13e, 13f | 5 |
| 2 | 13g | 1 |
| 3 | 13h, 13i | 2 |
| 4 | 13j | 1 |

## 4. Collision points

| Where | Who | Handling |
|---|---|---|
| `packages/contracts/src/curation.ts` | 13d (sources), 13f (value), 13g (annotations) | Different blocks of the file; a conflict shows as a marker. |
| Migrations | 13d, 13e, 13f, 13g | Numbered at merge time; whoever merges second renumbers and re-chains the snapshot `prevId`. |
| Permission catalog | 13e (removes `accepted.manage`), 13g (adds `records.withdraw_imported`) | Run the whole web suite: the `RoleDialog` test hardcodes the group order. |
| `apps/api/src/dataset/summary.ts` | 13e (accepted), 13f (numeric) | Different functions. |
| `apps/api/src/dataset/curation.ts` | 13e (accepted block), 13g (the rest) | 13g starts after 13e merges. |

## 5. Decisions and deliberate cuts

- **Reimport.** When the new source file with `ID` arrives, the imported records are replaced through the replacing import of RFC-64 R12. The runbook in 13f stops unless manual records, annotations and `record_references` are all zero, and takes a `pg_dump` first. `accepted_values` is dropped without keeping its rows (the owner confirmed it holds no real data).
- **ZIP.** The API has no ZIP library, and `records.csv` can reach about 2 GB. 13i adds one small streaming ZIP dependency with ZIP64 support (candidate: `yazl`), pinned exact.
- **Cut:** undoing a validation, reverting a resolution, migrating old `dispute`/`neutral` rows, and ISSN. Add when asked.

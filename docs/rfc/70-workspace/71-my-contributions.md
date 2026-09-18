# RFC-71 — My contributions

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

A contributor's own records and annotations are scattered across the species pages they came from. This RFC gives them one screen: what they have recorded, what they have annotated, and a summary of their standing (contests raised, complements added, validations given, disputes raised, withdrawals, and how many of their records are the current accepted value). A manager with `contributions.read` can open the same view for another user, under the admin prefix like every other per-user route (RFC-50).

## Rules

- **R1** `GET /api/me/contributions?kind=records|annotations&traitId=&speciesId=&review=&intent=&from=&to=&cursor=&limit=` (`dataset.read`, visibility RFC-33). `kind` required. `from` / `to` are ISO dates (inclusive day bounds in UTC). `review` (records only) is one of RFC-63 R6's statuses; `intent` (records only) `contest | complement | none`.
- **R2** `kind=records`: manual records with `created_by = viewer`, newest first (keyset on `id`), as record items (RFC-63 R8 with plan 09a's `intent` and `respondsTo`) plus `isAccepted: boolean` (the record is the current accepted value of its species and trait) and `responseCount: number` (records responding to it).
- **R3** `kind=annotations`: the viewer's `record_annotations` newest first (keyset on `id`) as `{ id, kind, note, reference, generated, createdAt, record: <record item> }`; `generated: boolean` as `annotationSchema` (`packages/contracts/src/dataset.ts`) already exposes, rendered by the web page as "automatic". The filters apply to the annotated record.
- **R4** `GET /api/me/contributions/summary` (`dataset.read`): `{ records, contests, complements, validations, disputes, withdrawn, accepted }` — counts of the viewer's manual records, those with each intent, their `confirm` annotations, their `dispute` annotations, their records with a `withdraw` annotation, and their records that are the current accepted value. One query per number over indexed columns; `record_annotations` gains index `(actor_id, id desc)` and `trait_records` gains partial index `(created_by, id desc) where created_by is not null`.
- **R5** `GET /api/admin/users/:id/contributions` and `/summary` (`contributions.read`) answer the same for another user (404 `USER_NOT_FOUND`); the viewer's own visibility applies (a manager is unrestricted; the route never widens what the viewer may see).
- **R6** Nothing here writes; no audit entries.

R2/R3 apply RFC-33: a viewer's own record on a species they may no longer see is omitted from the lists; the summary (R4) counts every row regardless, so the numbers stay true.

## Open questions

None.

## Changelog

- 2026-09-18 — created (plan 11a).
- 2026-09-18 — accepted.

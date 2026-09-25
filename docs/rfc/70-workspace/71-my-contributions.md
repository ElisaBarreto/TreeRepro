# RFC-71 — My contributions

| Field | Value |
|---|---|
| Status | draft |
| Category | workspace |
| Supersedes | — |

## Context

A contributor's own records and annotations are scattered across the species pages they came from. This RFC gives them one screen: what they have recorded, what they have annotated, and a summary of their standing (contests raised, complements added, validations given). A manager with `contributions.read` can open the same view for another user, under the admin prefix like every other per-user route (RFC-50).

## Rules

- **R1** `GET /api/me/contributions?kind=records|annotations&traitId=&speciesId=&review=&intent=&from=&to=&cursor=&limit=` (`dataset.read`, visibility RFC-33). `kind` required. `from` / `to` are ISO dates (inclusive day bounds in UTC). `review` is one of RFC-63 R6's statuses; `intent` is `contest | complement | none`.
- **R2** `kind=records`: manual records with `created_by = viewer` that are not withdrawn (RFC-63 R13), newest first (keyset on `id`), as record items (RFC-63 R8 with plan 09a's `intent` and `respondsTo`) plus `responseCount: number` (records responding to it).
- **R3** `kind=annotations`: the viewer's `confirm` annotations on visible records and their Keep-both resolutions (`kind: 'resolve'`, RFC-65 R16), newest first (`withdraw` rows sit on records that have left the dataset, RFC-63 R13; `dispute` and `neutral` rows are ignored, RFC-63 R7; keyset on `id`) as `{ id, kind, note, reference, generated, createdAt, record: <record item> }`; `generated: boolean` as `annotationSchema` (`packages/contracts/src/dataset.ts`) already exposes, rendered by the web page as "automatic". A resolution's `record` is `null` when its contest created no record, and otherwise the first record its contest created by `record_code`. For a resolution, `speciesId` and `traitId` apply to its contest's species and trait, and `review` and `intent` exclude a resolution whose `record` is `null`. The filters apply to the annotated record.
- **R4** `GET /api/me/contributions/summary` (`dataset.read`): `{ records, contests, complements, validations }` — counts of the viewer's manual records that are not withdrawn (RFC-63 R13), those with each intent — except `contests`, which counts the viewer's contests that are not withdrawn (RFC-63 R14), one per contest, whether or not it created a record — and their `confirm` annotations on records that are not withdrawn. One query per number over indexed columns; `record_annotations` gains index `(actor_id, id desc)` and `trait_records` gains partial index `(created_by, id desc) where created_by is not null`.
- **R5** `GET /api/admin/users/:id/contributions` and `/summary` (`contributions.read`) answer the same for another user (404 `USER_NOT_FOUND`); the viewer's own visibility applies (a manager is unrestricted; the route never widens what the viewer may see). The summary is visibility-blind for another user too, as R4's is for the viewer: its counts may exceed what the caller could list themselves, e.g. a plot-restricted manager's `records` count includes activity outside their own plots (RFC-67).
- **R6** Nothing here writes; no audit entries.

R2/R3 apply RFC-33: a viewer's own record on a species they may no longer see is omitted from the lists; the summary (R4) counts every row regardless, so the numbers stay true.

## Open questions

None.

## Changelog

- 2026-09-18 — created (plan 11a).
- 2026-09-18 — accepted.
- 2026-09-18 — amended: R1 no longer marks `review`/`intent` records-only, and R5 notes the cross-user summary is visibility-blind.
- 2026-09-25 — R1's `review` takes RFC-63 R6's new states; R2 drops `isAccepted` and withdrawn records; R3 lists validations and resolutions; R4 drops `disputes`, `withdrawn` and `accepted` (record model revision R-1, R-11, R-13; plan 13a); owner ruling: a contest states the correct levels (R3: a resolution may have no record, and the filters read its contest; R4: `contests` counts contests). `draft` until plan 13g (13e drops the accepted parts).

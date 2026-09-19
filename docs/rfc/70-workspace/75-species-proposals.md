# RFC-75 — Species proposals

| Field | Value |
|---|---|
| Status | draft |
| Category | workspace |
| Supersedes | — |

## Context

A contributor who cannot find a species in the catalog has no way to ask for it today short of contacting a manager directly. This RFC gives them a proposal: a name and a note, submitted through the workspace, checked against a taxonomy lookup (RFC-81) so the reviewer sees a match before deciding, and queued for a manager or admin to approve (creating the species, RFC-60 R9) or reject. The lookup result is stored with the proposal rather than recomputed at review time, so what the reviewer sees is what was true when the contributor submitted the name.

## Rules

- **R1** Table `species_proposals(id uuid default uuidv7(), proposed_name text not null, note text null, proposer_id uuid not null references users, status text not null default 'open' check in ('open', 'approved', 'rejected'), lookup jsonb null, lookup_at timestamptz null, species_id uuid null references species restrict, decided_by uuid null references users, decided_at timestamptz null, decision_note text null, created_at timestamptz not null default now(); check (status = 'open') = (decided_at is null); check (status = 'approved') = (species_id is not null); unique partial index (lower(proposed_name)) where status = 'open'; index (status, id desc); index (proposer_id, id desc))`.
- **R2** `POST /api/species/proposals { name, note? }` (`taxa.propose`): `name` 3–200 characters normalised per RFC-60 R2; `note` 1–2,000. A visible species with that canonical or alternative name → 409 `SPECIES_NAME_TAKEN` with `details: [{ path: 'name', message: <species id> }]` (the web app links to it); an open proposal with the same name (case-insensitive) → 409 `PROPOSAL_EXISTS` with the proposal id. Otherwise insert with `status = 'open'`, run the lookup (RFC-81) and store its result (or `null` on failure) — the lookup runs before the insert so the row is written once; a lookup failure never fails the request. Answer 201 with the proposal (R6). Audit `proposals.created` (target `species_proposals`, no name in metadata).
- **R3** `GET /api/species/proposals?status=&cursor=&limit=` (`taxa.manage`) lists proposals newest first (keyset on `id`), `status` default `open`. `GET /api/species/proposals/:id` (`taxa.manage`, or the proposer through `GET /api/me/proposals` — R5). Unknown → 404 `PROPOSAL_NOT_FOUND`.
- **R4** Decisions (`taxa.manage`, one transaction, audited): `POST /api/species/proposals/:id/approve { canonicalName, nameSource, genusName?, familyName?, alternativeNames?: [{ name, nameType, language?, source? }] }` creates the species as `POST /api/species` would (RFC-60 R9; genus and family created when missing, as `SpeciesDialog` does today), sets `status = 'approved'`, `species_id`, `decided_by`, `decided_at`; a name collision answers 409 `SPECIES_NAME_TAKEN`. `POST /api/species/proposals/:id/reject { note }` sets `rejected` with `decision_note`. A decided proposal refuses another decision (409 `PROPOSAL_DECIDED`). Audit `taxa.created` for the species (as today) and `proposals.decided` with `metadata: { decision, speciesId }`.
- **R5** `GET /api/me/proposals?cursor=&limit=` (`taxa.propose`) lists the viewer's proposals newest first, any status. The proposer is never e-mailed; the status shows in My contributions (RFC-71; this RFC gains it a **Proposals** tab).
- **R6** Representation: `{ id, proposedName, note, status, proposer: { id, name }, lookup: <RFC-81 R3> | null, lookupAt, species: { id, canonicalName } | null, decidedBy: { id, name } | null, decidedAt, decisionNote, createdAt }`.
- **R7** The dashboard's `queues.proposals` (RFC-72) and the digest's `proposals` (RFC-74) count open proposals / proposals created in the window.

Web (plan 12c): on the species list, when a search returns nothing and the viewer holds `taxa.propose`, an empty state "No species matches *q*" with **Propose this species** opening `ProposeSpeciesDialog` (name prefilled, note); the dialog maps 409s to "This species exists — open it" / "Already proposed". Queue `/app/curation/proposals` (nav **Proposals**, `taxa.manage`, RFC-13 R2): table (name, proposer, date, lookup verdict badge: *exact match*, *fuzzy*, *not found*, *lookup failed*), a detail drawer with the GBIF and WCVP match cards (scientific name, rank, status, family, genus, confidence, link to the GBIF page), **Approve** (opens `SpeciesDialog` prefilled from the match: canonical name, `nameSource` `wcvp` when the WCVP match is exact, else `gbif` or `original`, genus, family) and **Reject** (note). My contributions gains the Proposals tab (status badge, decision note, link to the created species).

## Open questions

None.

## Changelog

- 2026-09-19 — created (plan 12c).

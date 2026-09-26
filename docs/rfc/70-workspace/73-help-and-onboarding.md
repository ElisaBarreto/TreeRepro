# RFC-73 — Help and onboarding

| Field | Value |
|---|---|
| Status | draft |
| Category | workspace |
| Supersedes | — |

## Context

Contributors meet a vocabulary (validate, contest, complement, personal observation, plot scope) that the interface explains in tooltips but that deserves a place to read in full. A contributor arriving from an invitation also needs a first checklist rather than an empty dashboard. This RFC gives the workspace a help section and a getting-started card, and lets the tooltips of plan 09b (`HelpTip`) link into it.

## Rules

- **R1** Routes `/app/help` (index) and `/app/help/$topic` under the `/app` layout (RFC-13 R2 amended), available to every signed-in user (no permission). The topics are the ones stored (R2); the seed has `getting-started`, `workflow` (validate / contest / complement, what each button does and records, contested levels and how a reviewer resolves them), `vocabulary` (traits, categories, levels, units, why no free text), `references` (DOIs, books and ISBNs, personal observation, several references), `scope` (plots, the toggle, inactive species and traits), `contributions` (the My contributions page, withdrawal), `faq`, `contact`. An unknown topic renders the index.
- **R2** Help content is stored in the database (R6) and edited on the site (R7): the topics are the rows of `help_topics` in `position` order, each with its sections in `position` order. A section's title renders as an `h2` carrying the section's `anchor` as its id, so a link can target `/app/help/<slug>#<anchor>`; a section with an empty title renders its body only, with no heading. Migration `help_seed` seeds the eight topics of R1 from the former TSX modules (`apps/web/src/content/help/<topic>.tsx`, removed); after that the database is the only source, and a seeded topic or section is edited or deleted like any other.
- **R3** The home page shows a **Getting started** card to a viewer whose contribution summary (RFC-71 R4) is all zeros: a checklist linking to the help topics and to the species page, and a "Hide this card" button remembered under `localStorage['treerepro.gettingStarted.hidden']`. The card never shows for a viewer with any contribution. It opens directly with the checklist, with no introductory sentence.
- **R4** Every `HelpTip` of plan 09b gains a "Learn more" link to its topic anchor. Content can be deleted (R6), so a link may name a topic or section that no longer exists: a missing section lands on the top of its topic, a missing topic on the index (R1). Nothing checks the links against the stored content.
- **R5** Copy is English. The owner edits it on the site (R7), without a release.
- **R6** Tables `help_topics(id uuid default uuidv7(), slug text unique, title text, summary text default '', position integer, created_at, updated_at)` and `help_sections(id uuid default uuidv7(), topic_id uuid references help_topics on delete cascade, anchor text null, title text default '', body_html text default '', position integer, created_at, updated_at, unique (topic_id, anchor))`. API:
  - `GET /api/help` answers the topics `[{ id, slug, title, summary }]` and `GET /api/help/:slug` one topic with its `sections: [{ id, anchor, title, bodyHtml }]` (404 `HELP_TOPIC_NOT_FOUND`); both are self-service (RFC-32 R5): every signed-in user reads the help.
  - Writes require `help.edit`: `POST /api/help` `{ title, summary? }` creates a topic at the end; `PATCH /api/help/:id` `{ title?, summary?, position? }`; `DELETE /api/help/:id` deletes it with its sections; `POST /api/help/:id/sections` `{ title?, bodyHtml? }` adds a section at the end of the topic; `PATCH /api/help/sections/:id` `{ title?, bodyHtml?, position? }`; `DELETE /api/help/sections/:id`. An unknown id answers 404 `HELP_TOPIC_NOT_FOUND` or `HELP_SECTION_NOT_FOUND`.
  - `slug` and `anchor` are generated from the title on creation (lowercase ASCII, runs of other characters become `-`) and never change afterwards, so a copied link keeps working; a clash answers 409 `HELP_SLUG_TAKEN` or `HELP_ANCHOR_TAKEN`. A section created with no title has no anchor.
  - `position` moves the item to that 0-based place among its siblings (clamped), shifting the others; a position that moves nothing records nothing.
  - Limits: `title` 1–200 characters trimmed (a section's may be empty), `summary` up to 500, `body_html` up to 100,000; a violation answers 400 `VALIDATION_FAILED`.
  - Each write records `help.created`, `help.updated` (`metadata.fields`, and `metadata.previous` with the title and summary or the title and body before the edit) or `help.deleted` (`metadata.title`, and `metadata.previous` with the deleted section, or the deleted topic with all its sections), so a bad edit or deletion can be put back in its transaction (RFC-41 R5), with `target_type` `help_topics` or `help_sections`.
- **R7** A holder of `help.edit` sees the edit controls on the help pages: **New topic** on the index; on a topic, **Edit** (title and summary), **Delete**, and **Add section**; on each section, **Edit**, **Delete**, **Move up** and **Move down**. A section is edited with a rich-text editor (bold, italic, heading, lists, link) that can switch to its raw HTML. Deleting asks for confirmation. Nobody else sees these controls (RFC-32 R8).
- **R8** `body_html` is sanitised by the API before it is stored (RFC-02): only an allowlist of formatting elements and attributes is kept — `script`, `style`, `iframe`, `id` and event-handler attributes and `javascript:` URLs are removed. Production's CSP renders same-origin images only. The web app renders the stored HTML as is, and a click on a link to a same-origin path navigates inside the app rather than reloading it.

## Open questions

None.

## Changelog

- 2026-09-19 — created.
- 2026-09-19 — accepted.
- 2026-09-25 — R1 topics cover contested levels and books; R3 Getting started loses its opening sentence (record model revision R-9, R-16, R-18; plan 13a). `draft` until plan 13j (13b does R3).
- 2026-09-26 — R6: audit entries keep the previous text (pre-PR review).
- 2026-09-26 — R1, R2, R4, R5 amended, R6–R8 added: help content in the database, edited on the site by `help.edit` holders (issue #172, merged with plan 13j #151).

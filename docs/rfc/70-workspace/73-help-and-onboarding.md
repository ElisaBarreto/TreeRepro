# RFC-73 — Help and onboarding

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

Contributors meet a vocabulary (validate, contest, complement, personal observation, plot scope) that the interface explains in tooltips but that deserves a place to read in full. A contributor arriving from an invitation also needs a first checklist rather than an empty dashboard. This RFC gives the workspace a help section and a getting-started card, and lets the tooltips of plan 09b (`HelpTip`) link into it.

## Rules

- **R1** Routes `/app/help` (index) and `/app/help/$topic` under the `/app` layout (RFC-13 R2 amended), available to every signed-in user (no permission). Topics: `getting-started`, `workflow` (validate / contest / complement, what each button does and records), `vocabulary` (traits, categories, levels, units, why no free text), `references` (DOIs, personal observation, several references), `scope` (plots, the toggle, inactive species and traits), `contributions` (the My contributions page, withdrawal), `faq`, `contact`. An unknown topic renders the index.
- **R2** Content is TSX under `apps/web/src/content/help/<topic>.tsx`, exporting `{ slug, title, summary, body }`; the index lists every topic; headings carry ids so `HelpTip`s can link `#anchor`s (`/app/help/workflow#contest`).
- **R3** The home page shows a **Getting started** card to a viewer whose contribution summary (RFC-71 R4) is all zeros: a checklist linking to the help topics and to the species page, and a "Hide this card" button remembered under `localStorage['treerepro.gettingStarted.hidden']`. The card never shows for a viewer with any contribution.
- **R4** Every `HelpTip` of plan 09b gains a "Learn more" link to its topic anchor.
- **R5** Copy is English, reviewed by the owner before the plan merges (the plan lists the paragraphs; the owner edits the TSX later without a release process).

## Open questions

None.

## Changelog

- 2026-09-19 — created.
- 2026-09-19 — accepted.

# Platform 12a — Help Pages and Getting Started — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before the pull request, review the branch with CodeRabbit only (`coderabbit:code-review`).

**Goal:** `/app/help` and `/app/help/$topic` with eight TSX topics, anchors every `HelpTip` links to through `learnMore`, and a "Getting started" card on the home page shown until the viewer's first contribution (dismissable, remembered in `localStorage`).

**Architecture:** Web only. Topics are modules under `apps/web/src/content/help/` exporting `{ slug, title, summary, body }`; `HELP_TOPICS` is the ordered index; `Prose` is a layout applying typography classes to headings, paragraphs, lists and tables; `helpHref(topic, anchor?)` builds links, and a test asserts every `learnMore` target in the codebase points at an existing anchor.

**Spec:** `docs/specs/2026-09-17-platform-design.md` §3, §9. Depends on plans 09b (`HelpTip`) and 11b (dashboard summary for the card).

## Global Constraints

Same as plan 08a (web parts: RFC-13 R5 no inline styles; component tests). Branch `feat/platform-12a` in worktree `../Elisa-12a`. Copy is English; the owner reviews the wording on the PR.

## File structure (end state)

```
docs/rfc/70-workspace/73-help-and-onboarding.md
docs/rfc/10-platform/13-presentation-layer.md            # routes
apps/web/src/content/help/index.ts                       # HELP_TOPICS, helpHref, HelpTopic type
apps/web/src/content/help/getting-started.tsx, workflow.tsx, vocabulary.tsx, references.tsx, scope.tsx, contributions.tsx, faq.tsx, contact.tsx
apps/web/src/content/help/anchors.test.ts                # every learnMore target exists
apps/web/src/components/help/Prose.tsx (+ test)
apps/web/src/pages/help/HelpIndexPage.tsx, HelpTopicPage.tsx (+ tests)
apps/web/src/routes/app/help/index.tsx, $topic.tsx
apps/web/src/components/workspace/GettingStartedCard.tsx (+ test)
apps/web/src/pages/WorkspacePage.tsx (+ test)
apps/web/src/components/ui/HelpTip.tsx                   # learnMore prop already exists (plan 09b); uses helpHref
apps/web/src/components/shell/nav.ts, Icon.tsx (help)
apps/web/src/lib/storage.ts (+ test)                     # readFlag / writeFlag with try/catch
```

---

### Task 1: RFC-73

- [ ] `docs/rfc/70-workspace/73-help-and-onboarding.md`, `draft`, R1–R5 verbatim from the spec §3; RFC-13 R2 routes; README row. Commit — `docs(rfc): RFC-73 help and onboarding (plan 12a)`.

---

### Task 2: Topic index, `Prose`, pages

**Interfaces:**

```ts
export interface HelpTopic { slug: string; title: string; summary: string; body: ReactNode }
export const HELP_TOPICS: readonly HelpTopic[]          // order: getting-started, workflow, vocabulary, references, scope, contributions, faq, contact
export function helpHref(slug: string, anchor?: string): string   // `/app/help/${slug}${anchor ? `#${anchor}` : ''}`
export const HELP_ANCHORS: Record<string, readonly string[]>        // slug → heading ids, kept beside each topic
```

- [ ] **Step 1: Failing tests** — `HelpIndexPage` lists eight titles with summaries linking to `helpHref(slug)`; `HelpTopicPage` for `workflow` renders its `h1` and the sections `validate`, `contest`, `complement` (ids); an unknown slug renders the index; the nav shows "Help" for any session; breadcrumb `Help › Workflow`.
- [ ] **Step 2: Topics** — write the eight bodies. Required content (headings with ids in brackets):
  - **getting-started**: What TreeRepro is (`what`); Your first ten minutes (`first-steps`: read the workflow, open your plots, validate a record, add an entry); Where to ask (`contact`).
  - **workflow**: Validate (`validate`: what it records, that nothing changes, the optional supporting DOI); Add a different record (`different`); Contest (`contest`: "the existing value is wrong; mine should replace it", the automatic dispute, how to take it back by withdrawing); Complement (`complement`); Withdraw (`withdraw`); What managers and the admin do next (`review`: accepted values, disputed queue).
  - **vocabulary**: Traits and categories (`traits`); Levels (`levels`: why no free text, what to do when a level is missing — contact the admin); Units and numbers (`units`); Descriptions (`descriptions`: the `?` tips).
  - **references**: DOIs (`doi`: format, the live check, what happens when a DOI is unknown); Personal observation (`personal-observation`); Several references (`several`: one record per reference); Where references come from (`bibliography`: the references page).
  - **scope**: Plots (`plots`); Showing species outside your plots (`outside`); Inactive species and traits (`inactive`); Why a species you know is missing (`missing-species`: propose it — link to the proposals help once plan 12c ships; until then "contact the admin").
  - **contributions**: The My contributions page (`page`); Statuses (`statuses`: unreviewed, confirmed, disputed, withdrawn, accepted); Withdrawing (`withdraw`).
  - **faq**: at least: "Can I edit a record?" (`edit`: no — add a different record), "Who sees my name?" (`names`: signed-in scientists with dataset access), "Can I download the data?" (`download`: the admin exports; ask), "What if two people disagree?" (`disagree`).
  - **contact**: the project contact e-mail from `content/project.ts` and what to include in a message (`what-to-send`).
- [ ] **Step 3: `Prose`** — `<article className="prose-treerepro">` where the classes are Tailwind utilities on child selectors defined in `styles.css` (`.prose-treerepro h2 { @apply … }` is fine: it is a stylesheet, not an attribute). Headings render `id`s from the topic body (authors write `<h2 id="contest">`).
- [ ] **Step 4: `anchors.test.ts`** — imports `HELP_ANCHORS` and greps `apps/web/src` for `learnMore={helpHref('…', '…')}` literals (use `import.meta.glob('../../**/*.tsx', { query: '?raw', import: 'default', eager: true })` — the `as` option is deprecated since Vite 5) and asserts each pair exists. Wire `learnMore` on the plan 09b tips: Validate → `workflow#validate`, Add different record → `workflow#different`, DOI hint → `references#doi`, personal observation line → `references#personal-observation`, trait tips → `vocabulary#descriptions`, scope toggle → `scope#outside`.
- [ ] **Step 5: Commit** — `feat(web): help pages and topic index (RFC-73 R1, R2, R4)`.

---

### Task 3: Getting started card

- [ ] **Step 1: `lib/storage.ts`** — `readFlag(key): boolean` / `writeFlag(key, value)` around `localStorage` in try/catch (private mode); test with a throwing storage.
- [ ] **Step 2: Failing tests** — with a dashboard summary of all zeros the card renders the checklist (four items linking to `helpHref('workflow')`, `/app/species?scope=plots`, `/app/species?sort=completeness`, `/app/species?traitData=missing`); "Hide this card" writes `treerepro.gettingStarted.hidden` and unmounts it; with any non-zero count the card never renders; with the flag set it never renders.
- [ ] **Step 3: Implement; commit** — `feat(web): Getting started card (RFC-73 R3)`.

---

### Task 4: Close-out

- [ ] RFC-73 → accepted; spec status; owner review of the copy on the PR; full checks; E2E: `/app/help/workflow#contest` scrolls to the heading (assert the element is in view). PR `feat(web): help pages and onboarding card (plan 12a)`; one CodeRabbit run.

## Self-review

- Spec §3 R1–R2 → Task 2; R3 → Task 3; R4 → Task 2 step 4; R5 → Task 4.

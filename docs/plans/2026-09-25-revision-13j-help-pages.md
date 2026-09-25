# Revision 13j — Help Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the eight help topics from the owner's text (`data/text for pages/Text for help me pages.docx`), tightened and corrected to the revised record model (R-1…R-18), so every help page describes the platform as it is after plans 13a–13i.

**Architecture:** Web copy only. The eight modules under `apps/web/src/content/help/` keep their shape (`{ slug, title, summary, anchors, body }`), their slugs, their order in `index.ts` and every anchor something links to. Only `body`, `summary` and the anchor lists change. One new test in `HelpTopicPage.test.tsx` fails on words the revision retired and goes green once the copy is rewritten.

**Tech Stack:** React 19 TSX, TanStack Router `Link`, Vitest 5 + Testing Library, Biome 2.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` (§1 rules R-1…R-18, §2 screens, §3 row 13j). Owner text: `data/text for pages/Text for help me pages.docx` (read with `textutil -convert txt -stdout "data/text for pages/Text for help me pages.docx"`).

**Depends on:** 13h, merged into `main`, and through it 13a, 13d, 13e, 13f and 13g. The copy quotes 13h's final labels, so this plan runs last (wave 4).

## Global Constraints

- **RFC first.** 13a has already amended RFC-73 (help and onboarding) and the RFCs the copy describes (RFC-63, 65, 70, 71, 80…). This plan changes no rule. Before Task 1, read RFC-73 on `main`. If 13a changed R1's topic list or R5's review clause, follow the amended text and note it in the PR.
- **TDD.** Task 1 adds a failing test before any copy changes.
- **`@rfc` tags.** Each topic module keeps its `@rfc RFC-73 R1, R2` tag. The descriptive JSDoc line above it names RFCs without rule numbers, because 13a may renumber them.
- **English everywhere.** Apostrophes in JSX text are written `&rsquo;` and quotation marks `&ldquo;`/`&rdquo;`, as the current modules do.
- **Anchors are a contract.** `anchors.test.ts` checks every `helpHref(slug, anchor)` in the app, and `HelpTopicPage.test.tsx` checks that `workflow` carries `validate`, `different`, `contest`, `complement`, `withdraw` and `review` as `h2` ids. Every anchor that exists today stays, except `references` gaining `book`. `workflow#different` now titles the "Adding a record" section.
- **RFC-73 R5.** The owner reviews the copy on the PR before merge.
- Branch `feat/revision-13j-help` in worktree `../Elisa-13j`. Rebase on `main` before pushing; never merge `main` in. Push with `git -c http.version=HTTP/1.1 push`.
- Claim the issue first: `gh issue list --search "13j in:title"`, then `gh issue edit <n> --add-assignee @me --add-label in-progress`.
- Verification runs in Docker (no Node on this Mac). E2E is left to CI. The existing `apps/e2e/tests/help.spec.ts` asserts only the `#contest` id, which stays. No E2E change.
- Review with CodeRabbit locally (`coderabbit:code-review`) before opening the PR.

## File Structure

```
apps/web/src/pages/help/HelpTopicPage.test.tsx      # + one test: retired words are gone
apps/web/src/content/help/getting-started.tsx       # body rewritten
apps/web/src/content/help/workflow.tsx              # body, summary, anchor order
apps/web/src/content/help/vocabulary.tsx            # body
apps/web/src/content/help/references.tsx            # body, summary, + anchor `book`
apps/web/src/content/help/scope.tsx                 # body
apps/web/src/content/help/contributions.tsx         # body, summary
apps/web/src/content/help/faq.tsx                   # body
apps/web/src/content/help/contact.tsx               # body
```

Not touched: `index.ts` (same order, same slugs), `types.ts`, `href.ts`, `anchors.test.ts` (except in the case Task 6 Step 2 describes), `HelpIndexPage*`, `apps/e2e/tests/help.spec.ts`.

## UI labels the copy quotes (verify in Task 6 against merged `main`)

| Label in the copy | Where it must exist | Owner plan |
|---|---|---|
| `👍 Validate`, `👎 Contest`, `＋ Complement` | species page legend (§2); the buttons may show only the icon | 13h |
| `Do you confirm that this record is correct?` | validate dialog | 13h |
| `Contest` / `Complement` (first step of the entry form) | `AddEntriesDialog` / `ContestDialog` | 13h |
| `Add entries for another trait` | `pages/dataset/SpeciesPage.tsx` | existing |
| `Add the first entry` | `EmptyTraitCard.tsx`, `TraitSpeciesTable.tsx` | existing |
| `Show traits with no data` | `pages/dataset/SpeciesPage.tsx` | existing |
| `matches an existing record — counted as your validation` | entry form result | 13g/13h |
| `Withdraw` (button) and that it lives on the opened record | record drawer / record panel | 13h |
| `Contested` (badge, and species-list filter) | `RecordTable`/`TraitCard`, species filters | 13g/13h |
| `✓` / `✗` counts | record panel counts column | 13h |
| `Keep both`, `Withdraw level` | `DisputedPage` | 13g |
| `Disputed`, `Pending` (nav) | `components/shell/nav.ts` | existing |
| `Checking…`, `Resolved: …`, `DOI not found`, `Malformed DOI`, `Could not check the DOI — try again` | `components/curation/DoiField.tsx` | 13d |
| Only **Resolved** lets the form through | `DoiField` / `SourcesField` submit gating | 13d |
| ISBN + citation inputs, one row per reference, up to ten | `SourcesField` | 13d |
| `Personal observation` (with observer name) | `lib/references.ts` | existing |
| References page lists books as well as publications | `ReferencesPage` | 13d |
| `Your scope` | `components/workspace/ScopeCard.tsx` | existing |
| `Show species outside my plots` | `components/dataset/SpeciesSearchForm.tsx` | existing |
| `Propose this species`, `Proposals` tab | `SpeciesSearchPage.tsx`, `ContributionsPage.tsx` | existing |
| `Records`, `Annotations` tabs; summary counts records / contests / complements / validations | `pages/workspace/ContributionsPage.tsx` | 13e/13g |
| Sidebar `Species`, `Traits`, `References`, `My contributions` | `nav.ts` | existing |
| Quantitative fields: single value, minimum, maximum, mean, standard deviation, n | `ValueField` | 13h |
| Record ID (`EB_…` / `TR_…`) shown on a record | record panel or drawer | 13f/13h |
| Admin-only dataset export (ZIP, two CSVs) | species search header link | 13i |

---

### Task 1: Failing test — the retired words are gone

**Files:**
- Modify: `apps/web/src/pages/help/HelpTopicPage.test.tsx`

**Interfaces:** none new. Uses `HELP_TOPICS`, `renderAt`, and `Prose`'s `<article>`.

- [ ] **Step 1: Set up the worktree and claim the issue**

```sh
cd "/Users/elisabarreto/Library/CloudStorage/OneDrive-Personal/Documentos/Academia/PostDoc/TREE_CHANGE/TreeRepro"
git fetch origin && git worktree add ../Elisa-13j -b feat/revision-13j-help origin/main
gh issue list --search "13j in:title"          # then: gh issue edit <n> --add-assignee @me --add-label in-progress
```

- [ ] **Step 2: Add the test** at the end of the `describe('RFC-73 R1, R2 HelpTopicPage', …)` block:

```tsx
  // Plan 13j: the record model revision retired these words (spec R-1, R-3,
  // R-4, R-11, R-13, §2). A topic that still uses one describes a screen that
  // no longer exists. Read from the article only: the sidebar around it is
  // not help copy.
  it('describes the revised record model, not the retired one (plan 13j)', async () => {
    const retired = [
      /accepted value/i,
      /Add different record/,
      /\bNeutral\b/,
      /✓ Validate/,
      /one record per reference/i,
      /struck through/i,
    ];
    for (const topic of HELP_TOPICS) {
      const { container, unmount } = renderAt(`/app/help/${topic.slug}`);
      await screen.findByRole('heading', { level: 1, name: topic.title });
      const text = container.querySelector('article')?.textContent ?? '';
      expect(text, `${topic.slug} renders no article`).not.toBe('');
      for (const word of retired) {
        expect(text, `${topic.slug} still says ${word}`).not.toMatch(word);
      }
      unmount();
    }
  });
```

- [ ] **Step 3: Run it and watch it fail** (see Task 6 Step 1 for the container setup):

```sh
docker exec treerepro-13j sh -c 'cd /workspace && pnpm vitest run --project web apps/web/src/pages/help/HelpTopicPage.test.tsx'
```

Expected: FAIL. The first failure is `getting-started still says /accepted value/i`.

- [ ] **Step 4: Commit**

```sh
git -C ../Elisa-13j add apps/web/src/pages/help/HelpTopicPage.test.tsx
git -C ../Elisa-13j commit -m "test(web): help topics use the revised record model (plan 13j)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Getting started and Workflow

**Files:**
- Modify: `apps/web/src/content/help/getting-started.tsx`
- Modify: `apps/web/src/content/help/workflow.tsx`

**Interfaces:** anchors `getting-started`: `['what', 'first-steps', 'contact']` (unchanged). Anchors `workflow`: `['different', 'validate', 'contest', 'complement', 'withdraw', 'review']` (same set as before, reordered to match the body).

- [ ] **Step 1: Replace `getting-started.tsx` entirely with:**

```tsx
import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * What TreeRepro is and the first things to do in it (RFC-73, record model
 * as amended by plan 13a).
 * @rfc RFC-73 R1, R2
 */
export const gettingStarted: HelpTopicSource = {
  slug: 'getting-started',
  title: 'Getting started',
  summary: 'What TreeRepro is, and what to do in your first ten minutes.',
  anchors: ['what', 'first-steps', 'contact'],
  body: (
    <>
      <h2 id="what">What TreeRepro is</h2>
      <p>
        TreeRepro is a collective assembly of reproductive trait data for trees, covering flowers,
        fruits and seeds. Its core data comes from open-source papers and data repositories, and it
        is shared with a community of specialists who fill the gaps and validate or contest what is
        already there.
      </p>
      <p>
        Every value in the dataset is a <strong>record</strong>: one species, one trait, one value,
        the references it comes from, and an ID — <code>EB_</code> and a number for records from
        the compiled dataset, <code>TR_</code> and a number for records entered here. Records are
        never edited. You add to them, validate them or contest them, and each of those carries
        your name. TreeRepro keeps every claim side by side and never picks one; what it shows is
        how much agreement each has.
      </p>
      <p>Whenever you can, give a reference for what you enter: a DOI, or a book&rsquo;s ISBN.</p>

      <h2 id="first-steps">Your first ten minutes</h2>
      <ol>
        <li>
          Read <Link to={helpHref('workflow')}>Workflow</Link>. It is short, and every other screen
          assumes you know it.
        </li>
        <li>
          Open <strong>Species</strong> in the sidebar. If plots have been assigned to you, the list
          starts with the species of your plots; see <Link to={helpHref('scope')}>Scope</Link>.
        </li>
        <li>
          Open a species and find a trait you know well. If a value is right, press{' '}
          <strong>👍 Validate</strong> next to it. That is a real contribution: it tells everyone the
          value has been checked by someone who knows the species. If the value is wrong, press{' '}
          <strong>👎 Contest</strong>; if another value is also true, press{' '}
          <strong>＋ Complement</strong>.
        </li>
        <li>
          Tick <strong>Show traits with no data</strong>, pick a trait with no record yet and press{' '}
          <strong>Add the first entry</strong>. Give the value and its reference, or none if it is
          your own field observation.
        </li>
        <li>
          Or browse by trait: <strong>Traits</strong> in the sidebar shows, for each trait, every
          species with records for it.
        </li>
        <li>
          Open <strong>My contributions</strong> to see everything you have entered and validated,
          in one place.
        </li>
      </ol>

      <h2 id="contact">Questions or suggestions</h2>
      <p>
        If a species, a trait or a level you need is missing, or something here does not match what
        you see on screen, write to us. <Link to={helpHref('contact')}>Contact</Link> has the
        address.
      </p>
    </>
  ),
};
```

- [ ] **Step 2: Replace `workflow.tsx` entirely with:**

```tsx
import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * What each action on a species page does and what it records, and what
 * managers do next (RFC-70, RFC-65 as amended by plan 13a).
 * @rfc RFC-73 R1, R2
 */
export const workflow: HelpTopicSource = {
  slug: 'workflow',
  title: 'Workflow',
  summary: 'Add records, validate, contest, complement, withdraw — and what happens next.',
  anchors: ['different', 'validate', 'contest', 'complement', 'withdraw', 'review'],
  body: (
    <>
      <p>
        A record is never edited. Everything below adds something next to it, either a validation or
        a record of your own, so every value can be traced to the person and the reference it came
        from. On a species page, each level of a categorical trait and each record of a quantitative
        one carries three buttons: <strong>👍 Validate</strong>, <strong>👎 Contest</strong> and{' '}
        <strong>＋ Complement</strong>.
      </p>

      <h2 id="different">Adding a record</h2>
      <p>
        <strong>👎 Contest</strong>, <strong>＋ Complement</strong>,{' '}
        <strong>Add the first entry</strong> and <strong>Add entries for another trait</strong> all
        open the same form. It asks three things, in this order:
      </p>
      <ol>
        <li>
          If the species already has records for the trait, whether your entry{' '}
          <strong>contests</strong> or <strong>complements</strong> them. Nothing else in the form
          can be filled in until you answer, because the same value means something different in
          each case.
        </li>
        <li>
          The value. For a categorical trait, tick one level or several; each level becomes a record
          of its own. For a quantitative trait, give the numbers your source reports; see{' '}
          <Link to={helpHref('vocabulary', 'units')}>Units and numbers</Link>.
        </li>
        <li>
          Its references: one or more DOIs or books, or none for your own observation. Every record
          the form creates carries all of them. See{' '}
          <Link to={helpHref('references')}>References</Link>.
        </li>
      </ol>
      <p>
        If your entry matches a record that is already there (the same level, or the same numbers in
        all six fields), no second record is created. Your entry counts as a validation of the
        existing record, and the form says so: &ldquo;matches an existing record — counted as your
        validation&rdquo;. If the matching record is your own, the form only reports the duplicate.
      </p>

      <h2 id="validate">👍 Validate</h2>
      <p>
        <strong>👍 Validate</strong> says: I agree with this value as it stands. It asks &ldquo;Do
        you confirm that this record is correct?&rdquo; and, when you confirm, adds your name to the
        record as a validation. The record itself does not change. On a categorical trait,
        validating a level validates every record of that level.
      </p>
      <p>
        You may add a supporting reference, a DOI or a book&rsquo;s ISBN, for the source that makes
        you confident. Without one, your validation rests on your own knowledge, which is perfectly
        normal.
      </p>
      <p>
        You cannot validate your own records. Each person counts once per record, and a validation
        cannot be undone.
      </p>

      <h2 id="contest">👎 Contest</h2>
      <p>
        <strong>👎 Contest</strong> says: this value is wrong. You enter the value you believe is
        right, which must differ from the one you contest, with its reference if you have one.
      </p>
      <p>
        On a categorical trait you contest a level, and only that level. If a species has red, blue
        and orange and you contest &ldquo;blue&rdquo;, red and orange are untouched. On a
        quantitative trait you contest one record. Either way, the level or record you contested
        is marked <strong>Contested</strong> for everyone until a manager reviews it. To take a
        contest back, withdraw your contesting record.
      </p>

      <h2 id="complement">＋ Complement</h2>
      <p>
        <strong>＋ Complement</strong> says: this value is also correct, and I am adding another.
        A species can have more than one dispersal mode, biotic and abiotic for example. If only one
        is recorded, complement it with the other: both records are true and both belong in the
        dataset. On a quantitative trait, a complement adds another measurement, which helps capture
        variation within the species. A complement contests nothing.
      </p>

      <h2 id="withdraw">Withdraw</h2>
      <p>
        <strong>Withdraw</strong> takes a record back when you entered the wrong species, misread a
        table, or changed your mind. You can withdraw your own records at any time: open the record,
        press <strong>Withdraw</strong> and confirm. You do not have to write a note.
      </p>
      <p>
        A withdrawn record leaves the dataset. For every viewer, it disappears from every list, count
        and export. Managers can also withdraw records entered by others. Only the admin can
        withdraw a record imported from the compiled dataset.
      </p>

      <h2 id="review">What managers do next</h2>
      <p>
        Contested levels and records go to the managers&rsquo; <strong>Disputed</strong> queue. The
        responsible team reviews the original records, may contact the people who entered them,
        and settles the contest in one of two ways:
      </p>
      <ul>
        <li>
          by withdrawing one side: the contesting record, or the contested level with{' '}
          <strong>Withdraw level</strong>;
        </li>
        <li>
          or with <strong>Keep both</strong>, when both values turn out to be true.
        </li>
      </ul>
      <p>
        Either way the <strong>Contested</strong> mark clears. In a separate <strong>Pending</strong>{' '}
        queue, managers map by hand the imported values that the dictionary cannot read.
      </p>
      <p>
        None of this is instant. What you do is recorded the moment you press the button, though,
        and it shows on <strong>My contributions</strong> straight away.
      </p>
    </>
  ),
};
```

- [ ] **Step 3: Commit**

```sh
git -C ../Elisa-13j add apps/web/src/content/help/getting-started.tsx apps/web/src/content/help/workflow.tsx
git -C ../Elisa-13j commit -m "docs(web): help — getting started and workflow for the revised record model (plan 13j)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Vocabulary and References

**Files:**
- Modify: `apps/web/src/content/help/vocabulary.tsx`
- Modify: `apps/web/src/content/help/references.tsx`

**Interfaces:** anchors `vocabulary`: `['traits', 'levels', 'units', 'descriptions']` (unchanged). Anchors `references`: `['doi', 'book', 'personal-observation', 'several', 'bibliography']` (`book` added).

- [ ] **Step 1: Replace `vocabulary.tsx` entirely with:**

```tsx
import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * The words the trait dictionary uses: categories, traits, levels, units,
 * the quantitative fields and the descriptions behind the `?` tips (RFC-62,
 * record value as amended by plan 13a).
 * @rfc RFC-73 R1, R2
 */
export const vocabulary: HelpTopicSource = {
  slug: 'vocabulary',
  title: 'Vocabulary',
  summary: 'Traits, categories, levels and units — and why a value is chosen, not typed.',
  anchors: ['traits', 'levels', 'units', 'descriptions'],
  body: (
    <>
      <h2 id="traits">Traits and categories</h2>
      <p>
        A <strong>trait</strong> is one property of a species that can be recorded, such as seed
        mass, dispersal mode or pollination mode. Every trait belongs to a broad{' '}
        <strong>category</strong> such as flowers, fruits or pollination.
      </p>
      <p>Each trait is one of two kinds:</p>
      <ul>
        <li>
          <strong>Categorical</strong>: the value is one of a fixed list of levels.
        </li>
        <li>
          <strong>Quantitative</strong>: the value is a number, in the trait&rsquo;s own unit.
        </li>
      </ul>
      <p>
        The <strong>Traits</strong> page lists them all, category by category, with the number of
        species that have data for each. Open a trait to see how its records are distributed and
        which species are still missing it.
      </p>

      <h2 id="levels">Levels</h2>
      <p>
        The allowed values of a categorical trait are its <strong>levels</strong>. You choose them
        from a list. There is no free-text box, so records from different sources line up and can
        be counted together. You may choose several levels in one entry, and each becomes a record
        of its own.
      </p>
      <p>
        If the level you need is not in the list, do not force the nearest one. Write to us with
        the trait, the level you need and a reference that uses it.{' '}
        <Link to={helpHref('contact')}>Contact</Link> has the address.
      </p>

      <h2 id="units">Units and numbers</h2>
      <p>
        A quantitative trait has one standard unit, shown in brackets after its name, for example{' '}
        <em>Seed mass (mg)</em>. Every record of that trait is stored in that unit, so convert a
        value you read in grams before you enter it, and leave the unit out of the box: type{' '}
        <em>1200</em>, not <em>1200 mg</em>. Write a decimal point, not a comma, and no thousands
        separators.
      </p>
      <p>A quantitative record takes up to six numbers. Enter the ones your source reports:</p>
      <ul>
        <li>a single value;</li>
        <li>a minimum and a maximum;</li>
        <li>a mean, its standard deviation and the sample size (n).</li>
      </ul>
      <p>
        You must give at least one of the single value, minimum, maximum or mean. The minimum cannot
        exceed the maximum, the standard deviation cannot be negative, and n is a whole number of at
        least 1. If a source gives only a range, enter it as a minimum and a maximum; you do not need
        to invent a midpoint.
      </p>
      <p>
        On a species page, the trait card summarises these numbers. It shows the smallest and the
        largest value across the species&rsquo; records, and the mean of their single values. Where
        a record has no single value, its mean is used instead.
      </p>

      <h2 id="descriptions">Descriptions</h2>
      <p>
        The <strong>?</strong> next to a trait&rsquo;s name shows its description: what exactly is
        measured, and how. Read it before you enter a value, especially for a trait whose name is
        used differently in different literatures. If a description is missing, ambiguous or wrong,
        please tell us, because it affects every record of that trait.
      </p>
    </>
  ),
};
```

- [ ] **Step 2: Replace `references.tsx` entirely with:**

```tsx
import type { HelpTopicSource } from './types.ts';

/**
 * Where a claim comes from: DOIs and the live registry check, books by ISBN,
 * personal observations, several references on one record, and the
 * references page (RFC-80, RFC-61 as amended by plan 13a).
 * @rfc RFC-73 R1, R2
 */
export const references: HelpTopicSource = {
  slug: 'references',
  title: 'References',
  summary: 'DOIs, books, your own observations, and several references on one record.',
  anchors: ['doi', 'book', 'personal-observation', 'several', 'bibliography'],
  body: (
    <>
      <p>
        Every record names where its value comes from. There are three possible answers: a
        published work identified by its DOI, a book identified by its ISBN, or your own
        observation.
      </p>

      <h2 id="doi">DOIs</h2>
      <p>
        A DOI looks like <code>10.1234/abcd.5678</code>: the registrant prefix, a slash, and the
        publisher&rsquo;s own suffix. Paste it in whatever form you have it: bare, as{' '}
        <code>doi:10.1234/abcd.5678</code>, or as the full <code>https://doi.org/…</code> link.
      </p>
      <p>
        When you leave the DOI box, TreeRepro checks it against the DOI registry. The line under the
        field shows the result:
      </p>
      <ul>
        <li>
          <strong>Checking…</strong>: the check is running. Wait for it to finish.
        </li>
        <li>
          <strong>Resolved: …</strong>: the DOI is real, and the rest of the line names the work.
        </li>
        <li>
          <strong>DOI not found</strong>: the registry does not know it. Check the DOI against the
          paper itself.
        </li>
        <li>
          <strong>Malformed DOI</strong>: it is not shaped like a DOI. The usual causes are a
          missing digit, a stray space, or a page URL copied instead of the DOI.
        </li>
        <li>
          <strong>Could not check the DOI — try again</strong>: the registry could not be reached.
          This says nothing about your DOI. Click into the field and out again to run the check once
          more. If it keeps failing, let us know.
        </li>
      </ul>
      <p>
        Only <strong>Resolved</strong> lets the form through.
      </p>

      <h2 id="book">Books</h2>
      <p>
        For a book, give its ISBN (ISBN-10 or ISBN-13, with or without hyphens) and its citation:
        authors, year and title. TreeRepro checks the ISBN&rsquo;s check digit but does not look the
        book up online, so type the citation yourself. The same ISBN, however it is typed, is always
        the same book.
      </p>

      <h2 id="personal-observation">Personal observation</h2>
      <p>
        Give no reference when the value comes from your own field work or expert knowledge rather
        than from a publication. That is a legitimate source here, and it is the reason the dataset
        is shared with specialists.
      </p>
      <p>
        The value is recorded as <strong>your</strong> personal observation, a reference of its own
        that says whose observation it is. Nobody else can cite it as their source. If someone else
        observed the same thing, they record their own observation.
      </p>

      <h2 id="several">Several references</h2>
      <p>
        A value may rest on several sources. Add a row for each one, up to ten, mixing DOIs and
        books as needed. All of them belong to the record the form creates, or to each record if you
        chose several levels, and each one counts as used.
      </p>
      <p>
        A personal observation cannot be mixed with other references. If the value comes from the
        literature, give its references. If it is your own, give none.
      </p>

      <h2 id="bibliography">Where references come from</h2>
      <p>
        The <strong>References</strong> page in the sidebar lists the publications and books that the
        records cite, most used first, with how many records name each one as a primary and as a
        secondary source. Each has its own page showing its details and the traits it has been used
        for. Personal observations are not listed there. On a record, they read &ldquo;Personal
        observation&rdquo; with the observer&rsquo;s name.
      </p>
      <p>
        You never add a reference to that page yourself. Giving a DOI or an ISBN on a record creates
        it.
      </p>
    </>
  ),
};
```

- [ ] **Step 3: Commit**

```sh
git -C ../Elisa-13j add apps/web/src/content/help/vocabulary.tsx apps/web/src/content/help/references.tsx
git -C ../Elisa-13j commit -m "docs(web): help — vocabulary and references for quantitative fields and books (plan 13j)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Scope and Contributions

**Files:**
- Modify: `apps/web/src/content/help/scope.tsx`
- Modify: `apps/web/src/content/help/contributions.tsx`

**Interfaces:** anchors `scope`: `['plots', 'outside', 'inactive', 'missing-species']` (unchanged). Anchors `contributions`: `['page', 'statuses', 'withdraw']` (unchanged). `HelpTopicPage.test.tsx`'s RFC-75 R2 test needs `scope` to keep exactly one body link named `Species` to `/app/species` and the text `Propose this species`. The copy below keeps both.

- [ ] **Step 1: Replace `scope.tsx` entirely with:**

```tsx
import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * Which species and traits a viewer sees: plots, the species-list toggle,
 * retired rows and missing species (RFC-67, RFC-33, RFC-75).
 * @rfc RFC-73 R1, R2
 */
export const scope: HelpTopicSource = {
  slug: 'scope',
  title: 'Scope',
  summary: 'Plots, the species list beyond them, and rows that are retired rather than deleted.',
  anchors: ['plots', 'outside', 'inactive', 'missing-species'],
  body: (
    <>
      <h2 id="plots">Plots</h2>
      <p>
        Species belong to <strong>plots</strong>, which are field sites, and contributors are
        assigned to the plots they work on. That is how the project knows whom to ask about which
        species.
      </p>
      <p>
        Your plots are on the workspace home page under <strong>Your scope</strong>, each with the
        number of species it holds. If that card is not there, no plot has been assigned to you and
        you see the whole dataset. To be assigned to a plot, write to us.
      </p>

      <h2 id="outside">Showing species outside your plots</h2>
      <p>
        When you have plots, the <strong>Species</strong> page starts with their species only. Tick{' '}
        <strong>Show species outside my plots</strong> to search the whole dataset. Contributors who
        are restricted to their plots do not have that checkbox. Counts on a trait or a reference
        cover the whole dataset, so they can be larger than what you can list.
      </p>

      <h2 id="inactive">Inactive species and traits</h2>
      <p>
        Nothing scientific is deleted. A species, trait or level that should no longer be used is
        marked <strong>inactive</strong>. It is no longer offered for new records, and records that
        already point at it keep their value. Most contributors never see inactive rows. Managers
        and admins see them marked <em>inactive</em>.
      </p>

      <h2 id="missing-species">Why a species you know is missing</h2>
      <p>There are usually three possible reasons:</p>
      <ul>
        <li>
          It is outside your plots. Tick <strong>Show species outside my plots</strong> and search
          again.
        </li>
        <li>
          It is filed under another name. Each species is filed under its accepted name in the
          World Checklist of Vascular Plants (WCVP), but the search also matches synonyms and common
          names and tells you which name it matched. Search for the name you know. If that finds
          nothing, search for the genus alone.
        </li>
        <li>It is not in the dataset yet.</li>
      </ul>
      <p>
        In the last case, search the <Link to="/app/species">Species</Link> page for the name. When
        nothing matches, press <strong>Propose this species</strong> to send it to the reviewers.
        Their answer appears on the <strong>Proposals</strong> tab of{' '}
        <Link to="/app/contributions">My contributions</Link>. If you do not see that button, write
        to us with the species name, its authority and its plot, if it has one.{' '}
        <Link to={helpHref('contact')}>Contact</Link> has the address.
      </p>
    </>
  ),
};
```

- [ ] **Step 2: Replace `contributions.tsx` entirely with:**

```tsx
import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * The My contributions page, the one status a record can carry, and
 * withdrawal (RFC-71, RFC-63, RFC-65 as amended by plan 13a).
 * @rfc RFC-73 R1, R2
 */
export const contributions: HelpTopicSource = {
  slug: 'contributions',
  title: 'Contributions',
  summary: 'Your own records and annotations in one place, and what Contested means.',
  anchors: ['page', 'statuses', 'withdraw'],
  body: (
    <>
      <h2 id="page">The My contributions page</h2>
      <p>
        <strong>My contributions</strong> in the sidebar gathers everything you have done:
      </p>
      <ul>
        <li>
          <strong>Records</strong>: the records you entered, newest first, with their value, their
          references and whether they are contested.
        </li>
        <li>
          <strong>Annotations</strong>: your validations and other annotations, each shown with the
          record it is about.
        </li>
        <li>
          <strong>Proposals</strong>: the species you proposed and the reviewers&rsquo; answers, if
          your role lets you propose species.
        </li>
      </ul>
      <p>
        You can filter the lists, for example by trait, species or date. The filters are kept in the
        address bar, so a filtered view is a link you can share. Above the tabs, a row of counts
        summarises your work: the records you entered, how many of them contest or complement
        another record, and the validations you gave.
      </p>

      <h2 id="statuses">Statuses</h2>
      <p>
        There is one status, <strong>Contested</strong>. A level of a categorical trait, or a record
        of a quantitative one, is contested while a contest against it is open, meaning the contest
        has been neither withdrawn nor settled by a manager. A trait is contested for a species when
        any of its levels or records is. Everyone sees the mark, and you can filter the species list
        to show only <strong>Contested</strong> species.
      </p>
      <p>
        Otherwise a record has no status, only counts: ✓ for the people who validated it and ✗ for
        the people who contested it, each person counted once. TreeRepro never picks a winning
        value. A trait counts as <strong>validated</strong> for a species once at least one of its
        records has a validation.
      </p>
      <p>
        A contest stops counting when a record on either side is withdrawn, or when a manager
        chooses <strong>Keep both</strong>. See <Link to={helpHref('workflow', 'review')}>Workflow</Link>.
      </p>

      <h2 id="withdraw">Withdrawing</h2>
      <p>
        To withdraw one of your records, open it from this page, press <strong>Withdraw</strong> and
        confirm. A withdrawn record leaves the dataset and disappears from this page as well.{' '}
        <Link to={helpHref('workflow', 'withdraw')}>Workflow</Link> explains who can withdraw what.
      </p>
    </>
  ),
};
```

- [ ] **Step 3: Commit**

```sh
git -C ../Elisa-13j add apps/web/src/content/help/scope.tsx apps/web/src/content/help/contributions.tsx
git -C ../Elisa-13j commit -m "docs(web): help — scope and contributions, Contested as the only status (plan 13j)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: FAQ and Contact

**Files:**
- Modify: `apps/web/src/content/help/faq.tsx`
- Modify: `apps/web/src/content/help/contact.tsx`

**Interfaces:** anchors `faq`: `['edit', 'names', 'download', 'disagree']` (unchanged). Anchors `contact`: `['what-to-send']` (unchanged).

- [ ] **Step 1: Replace `faq.tsx` entirely with:**

```tsx
import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * The questions contributors ask first: editing, names, downloads and
 * disagreements (RFC-63, RFC-66, RFC-70, RFC-40 as amended by plan 13a).
 * @rfc RFC-73 R1, R2
 */
export const faq: HelpTopicSource = {
  slug: 'faq',
  title: 'FAQ',
  summary: 'Editing, names, downloads and disagreements — the four questions that come up first.',
  anchors: ['edit', 'names', 'download', 'disagree'],
  body: (
    <>
      <h2 id="edit">Can I edit a record?</h2>
      <p>
        No, and nobody else can either. Records are only ever added, never changed. That is what
        makes a value traceable: the record you read today says exactly what its reference said,
        with the name of the person who entered it.
      </p>
      <p>
        If a value is wrong, contest it with <strong>👎 Contest</strong>. If the mistake is in one of
        your own records, withdraw it and enter a new one. Both are explained in{' '}
        <Link to={helpHref('workflow')}>Workflow</Link>.
      </p>

      <h2 id="names">Who sees my name?</h2>
      <p>
        Signed-in scientists with access to the dataset. Your name appears next to the records you
        enter and the validations you give, on the species pages, in the curation queues and on
        your contributions page. Managers can also open your contributions page. The export, which
        only the admin can download, names the people who validated and contested each record. Your
        e-mail address is never shown next to your records or included in the export.
      </p>
      <p>Nothing here is public. Everything is behind sign-in.</p>

      <h2 id="download">Can I download the data?</h2>
      <p>
        Only the admin can download the whole dataset. The download is a ZIP of two CSV files: one
        with every record and one with every validation and contest. If you need data for an
        analysis, write to us and say what it is for and which traits or species you need.{' '}
        <Link to={helpHref('contact')}>Contact</Link> has the address.
      </p>

      <h2 id="disagree">What if two people disagree?</h2>
      <p>
        That is an ordinary and useful situation. The second person presses{' '}
        <strong>👎 Contest</strong> and enters their value. The contested level is marked{' '}
        <strong>Contested</strong> and goes to the managers&rsquo; <strong>Disputed</strong> queue.
        The responsible team reviews the original records and may contact the people who entered
        them. Then they either withdraw one side or keep both. Nothing is settled by editing. If you
        decide the other value was right after all, withdraw your contest.
      </p>
      <p>
        If both values are true, for example a species with two dispersal modes or a trait that
        varies between sites, use <strong>＋ Complement</strong> instead of a contest.
      </p>
    </>
  ),
};
```

- [ ] **Step 2: Replace `contact.tsx` entirely with:**

```tsx
import { CONTACT_EMAIL } from '../project.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * Where to write and what to put in the message; the address is the
 * project's own, from `content/project.ts` (RFC-72 R3).
 * @rfc RFC-72 R3
 * @rfc RFC-73 R1, R2
 */
export const contact: HelpTopicSource = {
  slug: 'contact',
  title: 'Contact',
  summary: 'Where to write when the app cannot answer, and what to put in the message.',
  anchors: ['what-to-send'],
  body: (
    <>
      <p>
        Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with any question,
        suggestion or comment about TreeRepro. A person reads every message, and there is no form to
        fill in.
      </p>
      <p>Some things only the admin can do, so they are worth writing about:</p>
      <ul>
        <li>adding a species, a trait or a level that is missing;</li>
        <li>correcting a trait&rsquo;s description or unit;</li>
        <li>assigning you to a plot, or changing your plots;</li>
        <li>withdrawing a record imported from the compiled dataset;</li>
        <li>exporting data for an analysis;</li>
        <li>anything that looks like a bug: a page that fails, a number that cannot be right.</li>
      </ul>

      <h2 id="what-to-send">What to include</h2>
      <ul>
        <li>
          <strong>Where you were:</strong> the page address from your browser, or the record&rsquo;s
          ID (<code>EB_…</code> or <code>TR_…</code>).
        </li>
        <li>
          <strong>What you expected, and what happened instead:</strong> one sentence each.
        </li>
        <li>
          <strong>The names in full:</strong> the species with its authority, the trait and the
          level.
        </li>
        <li>
          <strong>The reference,</strong> as a DOI or ISBN, if the message is about a source or a
          value taken from one.
        </li>
        <li>
          <strong>When it happened,</strong> if something failed. A date and a rough time are
          enough.
        </li>
      </ul>
      <p>Never send passwords or one-time codes. Nobody on the project will ever ask for them.</p>
    </>
  ),
};
```

- [ ] **Step 3: Commit**

```sh
git -C ../Elisa-13j add apps/web/src/content/help/faq.tsx apps/web/src/content/help/contact.tsx
git -C ../Elisa-13j commit -m "docs(web): help — FAQ and contact for the revised record model (plan 13j)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verify labels, run the suite, open the PR

**Files:** possibly `apps/web/src/content/help/*.tsx` (label fixes), and `apps/web/src/content/help/anchors.test.ts` only in the case Step 2 describes.

- [ ] **Step 1: Start a verify container and sync the worktree**

```sh
C=treerepro-13j
docker run -d --name "$C" -w /workspace treerepro-verify:base sleep infinity
cd ../Elisa-13j
docker exec "$C" sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +'
COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i "$C" tar -x -C /workspace
docker exec "$C" sh -c 'pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile'
```

If `treerepro-verify:base` is missing, build it first with the recipe in the `verify-in-docker-no-node` memory. Re-run the delete-then-tar sync before every check below.

- [ ] **Step 2: Check every quoted label against merged `main`.** For each row of the "UI labels the copy quotes" table, grep the owning component, for example:

```sh
grep -rn "Do you confirm that this record is correct\|Keep both\|Withdraw level\|counted as your validation" apps/web/src
grep -rn "'Contested'\|>Contested<" apps/web/src
grep -rn "label: '" apps/web/src/pages/workspace/ContributionsPage.tsx
grep -rn "helpHref('workflow', 'different')" apps/web/src
```

Fix the copy wherever a label differs. Use the component's exact wording, and keep the table in this plan in step with the copy. Specific cases:
  - If 13h removed the tip that links `workflow#different`, the anchor still stays; it titles "Adding a record". If 13h's `WIRED_FILES` in `anchors.test.ts` no longer lists `RecordActions.tsx` → `workflow#different`, change nothing there.
  - If the record ID is shown nowhere on screen, remove the "or the record's ID (`EB_…` or `TR_…`)" clause from `contact.tsx`. The sentence in `getting-started.tsx` stays, because the ID is still in the export.
  - If the contributions summary still shows other counts (for example withdrawn), the copy still holds: it names only the four counts that are certain.
  - If 13h puts **Withdraw** somewhere other than the opened record, change "open the record, press **Withdraw**" in `workflow.tsx` and `contributions.tsx` to the real place.

- [ ] **Step 3: Format, lint, typecheck and test**

```sh
docker exec "$C" sh -c 'cd /workspace && pnpm exec biome format --write apps/web/src/content/help apps/web/src/pages/help'
for f in getting-started workflow vocabulary references scope contributions faq contact; do
  docker cp "$C:/workspace/apps/web/src/content/help/$f.tsx" "apps/web/src/content/help/$f.tsx"
done
docker cp "$C:/workspace/apps/web/src/pages/help/HelpTopicPage.test.tsx" apps/web/src/pages/help/HelpTopicPage.test.tsx
git diff --stat   # formatting-only changes, if any
docker exec "$C" sh -c 'cd /workspace && pnpm lint && pnpm typecheck && pnpm rfc:check'
docker exec "$C" sh -c 'cd /workspace && pnpm vitest run --project web'
```

Expected: lint, typecheck and `rfc:check` clean. The whole web project passes, including `HelpTopicPage.test.tsx`'s new test and `anchors.test.ts`. The whole web project runs, not only the help tests, so that a `GettingStartedCard` or `HelpIndexPage` assertion that reads a summary gets exercised too.

- [ ] **Step 4: Commit any fixes from Steps 2–3**

```sh
git add apps/web/src/content/help apps/web/src/pages/help
git commit -m "docs(web): help copy matches the merged UI labels (plan 13j)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Skip this if `git status` is clean.)

- [ ] **Step 5: Re-check `main`, rebase, review, push**

```sh
git fetch origin && git rebase origin/main          # re-run Step 3 if main moved
# run CodeRabbit locally (coderabbit:code-review) on the branch; apply findings; re-run Step 3
git -c http.version=HTTP/1.1 push -u origin feat/revision-13j-help
```

- [ ] **Step 6: Open the PR for the owner's copy review (RFC-73 R5)**

```sh
gh pr create --title "docs(web): help pages for the revised record model (plan 13j)" --body "$(cat <<'EOF'
Rewrites the eight help topics from the owner's text (`data/text for pages/Text for help me pages.docx`), tightened and corrected to the record model revision (spec 2026-09-25, R-1…R-18, §2). Slugs, order and anchors are unchanged; `references` gains `#book`.

**Owner review (RFC-73 R5):** please read each topic under /app/help. The "Spec notes" section of `docs/plans/2026-09-25-revision-13j-help-pages.md` lists every place the copy departs from the docx and why.

Closes #<issue>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After merge: `gh issue edit <issue> --remove-label in-progress`, `docker rm -f treerepro-13j`, `git worktree remove ../Elisa-13j`.

---

## Spec notes

Places where the owner's docx conflicts with the approved spec or with the live app, and what the copy does about each. The owner confirms them on the PR.

1. **Button labels.** The docx has `✓ Validate`, `X Contest`, `+ Complement`. The copy uses `👍 Validate`, `👎 Contest`, `＋ Complement` (spec §2 legend). If 13h's buttons show only the icon, the copy still matches the legend's words.
2. **"+ Add record" does not exist.** The copy names the real entry points: 👎, ＋, **Add the first entry** and **Add entries for another trait**. All of them open one form.
3. **One record per reference (docx, Workflow) → one record per level, carrying all references** (R-3, R-4). The docx's "one record is created per reference you give" is dropped. The retired-words test enforces this.
4. **An identical claim "names the existing record" → it counts as your validation** (R-7). The copy quotes R-7's message and the own-record exception.
5. **Validate.** The docx describes the optional supporting source as `Add a supporting DOI (optional)`. The copy says a DOI or an ISBN (R-6, R-16) and quotes the §2 dialog question. It also adds R-6's limits: you cannot validate your own record, each person counts once, and a validation cannot be undone. Validating a level validates every record of that level (§2).
6. **Contest "raises a dispute … flags it for the managing team" → the level is marked Contested** (R-8, R-9, R-11). The copy avoids "dispute" as a verb. The managers' queue is still called **Disputed** (spec 13g row); verify the name in Task 6. The copy adds the rule that a contest touches only the contested level (R-8).
7. **Withdrawal.** The docx says only your own records can be withdrawn. The copy says: your own records at any time, with only a confirmation and no note; managers can withdraw other people's; imported records only by the admin; a withdrawn record leaves the dataset for everyone (R-12, R-13). "Struck through" is gone (retired-words test).
8. **References: "exactly two answers" → three** (R-16). A new `#book` section covers the ISBN (10 or 13, check digit, no lookup) and the required citation. Nothing links to `#book` yet.
9. **Quantitative: "the form takes one number" → six fields**, at least one of single, min, max or mean, with R-5's constraints. The docx's "average" is written as "mean" to match R-5. The trait-card summary sentence follows R-5's last clause.
10. **Statuses.** The docx says only "Every contested record carries a review status". The section is written from R-9 and R-10: Contested is the only status, it is visible to everyone, there is a Contested species filter (R-15), and it clears on withdrawal or **Keep both**. It also covers the ✓/✗ counts per distinct user (§2, 13g), no accepted value, and "validated" as the replacement count (R-1).
11. **My contributions.** The docx lists a status filter, a "disputes raised" count, and annotations such as "disputes and withdrawals". After 13e and 13g the accepted and dispute counts go away, and withdrawn records leave the page (R-13). The exact summary and filter set are 13g's call, so the copy stays general. It names only the four counts that survive (records, contests, complements, validations) and filters "for example by trait, species or date". It adds the existing **Proposals** tab, which the docx omits.
12. **FAQ "Who sees my name?"** The old copy said the export names no one. Under R-17, `annotations.csv` carries user names, so the copy says the admin-only export names who validated and contested, never e-mail addresses.
13. **FAQ "Can I download the data?"** is not in the docx. It is kept, because RFC-73 R1 and the `faq#download` anchor both exist, and rewritten for R-17: admin only, a ZIP of two CSV files.
14. **Scope.** The docx drops the plot toggle, the inactive rows and the propose flow, and says of a missing species "write to us and we will include it". The copy keeps **Show species outside my plots**, **Inactive species and traits** (named in RFC-73 R1's topic list) and **Propose this species** (RFC-75 R2, pinned by `HelpTopicPage.test.tsx`), and falls back to "write to us" when the button is not offered. The docx's "some synonyms" is kept as "synonyms and common names", because the import stores both.
15. **Record IDs** (R-2) are not in the docx. The copy adds one sentence in Getting started and the ID as a "where you were" hint in Contact. Task 6 drops the Contact clause if no screen shows the ID.
16. **Workflow structure.** The docx order is Adding, Withdrawing, then Validate, Contest and Complement. The copy runs Adding (anchor `different`, kept because `RecordActions` links it and `HelpTopicPage.test.tsx` requires it), Validate, Contest, Complement, Withdraw, then "What managers do next" (`review`, rewritten for Keep both and Withdraw level). The docx's "continuous" is written "quantitative" to match the UI and the spec.
17. **Does 👎 preselect Contest?** §2 says only that 👎 and ＋ "open the entry dialog" and that the Contest/Complement choice comes first. The copy says the form asks the question without claiming either button pre-answers it.
18. **RFC numbering.** 13a amends RFC-63, 65, 70, 71, 73 and 80 in parallel with this plan, and the rule numbers it lands on are unknown here. The JSDoc lines therefore cite RFCs without rule numbers. The `@rfc RFC-73 R1, R2` tags stay, on the assumption that 13a keeps those two rules; `pnpm rfc:check` in Task 6 catches it if not. RFC-73 R5 (owner review of the copy) is honoured through the PR. If 13a changed R5, follow the amended text.
19. **Contact.** The docx is a single line. The copy keeps it as the opening, then keeps the "what to include" list (anchor `what-to-send`). The "accepted value" bullet is replaced with "withdrawing a record imported from the compiled dataset" (R-12, admin only).
20. **Examples.** "Flowers twice a year" is replaced with the docx's dispersal-mode example. The red/blue/orange contest example comes from spec R-8, not from the docx.

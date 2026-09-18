import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext } from './users.ts';

/**
 * The category the trait below is created in. `POST /api/traits` refuses a
 * category the dictionary does not already hold and no route adds one, so it
 * has to be a key `scripts/e2e.sh` seeded from
 * `apps/api/seed/trait-dictionary.csv`. The Category select carries the key
 * as its option value (`SpeciesSearchForm.tsx`), which is what the
 * assertions below read.
 */
const CATEGORY_KEY = 'reproduction';

interface SpeciesRow {
  id: string;
}
interface ReferenceRow {
  id: string;
}
interface TraitRow {
  id: string;
  levels: Array<{ id: string; key: string }>;
}
interface CreatedRecords {
  created: Array<{ id: string }>;
}

/** Seeds through the API as the administrator; a refusal fails here, where it can still be read, rather than as a locator timing out later. */
async function create<T>(admin: BrowserContext, path: string, body: unknown): Promise<T> {
  const answer = await apiCall<{ data: T }>(admin, 'POST', path, body);
  if (answer.status !== 201 || !answer.json) {
    throw new Error(`POST ${path} answered ${answer.status}`);
  }
  return answer.json.data;
}

/** A search param as the address bar currently holds it; the page pushes with `replace`, so polling it is how the URL mirror is observed. */
function param(page: Page, key: string): string | null {
  return new URL(page.url()).searchParams.get(key);
}

test.describe('RFC-60 R6 / RFC-69 species trait filters and breadcrumb (plan 10a)', () => {
  test('a trait filter in missing mode lists the species with no data, opening one names it in the breadcrumb, and clearing the category drops the filter', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);

    // Everything after the context exists lives in the `try`, seeding
    // included: a refusal from one of the seeding calls would otherwise leak
    // the context. (`contribution.spec.ts` opens its `try` after the seeding
    // instead; this shape is the safer of the two, and that file is left
    // alone because it is already CI-validated.)
    try {
      const stamp = Date.now();
      // One shared prefix so the name box narrows the list to exactly these
      // two species, whatever else the stack holds by the time this file runs.
      const prefix = `E2E Coverage ${stamp}`;
      const missingName = `${prefix} nodata`;
      const coveredName = `${prefix} withdata`;
      const traitKey = `e2e_coverage_${stamp}`;

      const missingSpecies = await create<SpeciesRow>(admin, '/api/species', {
        canonicalName: missingName,
        nameSource: 'wcvp',
      });
      const coveredSpecies = await create<SpeciesRow>(admin, '/api/species', {
        canonicalName: coveredName,
        nameSource: 'wcvp',
      });
      const reference = await create<ReferenceRow>(admin, '/api/references', {
        citationKey: `E2E-COV-${stamp}`,
        title: 'Coverage of E2E trees',
        year: 2026,
      });
      let trait = await create<TraitRow>(admin, '/api/traits', {
        key: traitKey,
        categoryKey: CATEGORY_KEY,
        valueType: 'categorical',
        description: 'Whether this species has any record at all for the trait.',
      });
      // The level call answers the whole trait back, levels included.
      trait = await create<TraitRow>(admin, `/api/traits/${trait.id}/levels`, {
        key: 'e2e_present',
      });
      const level = trait.levels.find((candidate) => candidate.key === 'e2e_present');
      if (!level) {
        throw new Error(`the trait came back with levels ${trait.levels.map((l) => l.key)}`);
      }
      // RFC-69 R2: this insert is what the trait_records trigger turns into a
      // species_trait_coverage row and a species.trait_count of 1 — only for
      // the covered species, which is what the missing filter goes on.
      await create<CreatedRecords>(admin, '/api/records', {
        speciesId: coveredSpecies.id,
        traitId: trait.id,
        value: { levelId: level.id },
        sources: { references: [{ id: reference.id }] },
      });

      const page = await admin.newPage();
      // The deep link the trait page and the dashboard send people to. The
      // name is typed into the form rather than carried here, so nothing
      // depends on how a hand-written query string encodes a space.
      const deepLink = `/app/species?traitId=${trait.id}&traitData=missing`;
      const categorySelect = page.getByLabel('Category', { exact: true });
      const recordsHeader = page.getByRole('columnheader', { name: 'Records', exact: true });

      // ── The deep link arrives with the Traits group already showing it ────
      await page.goto(deepLink);
      // RFC-60 R6 amendment: the link names a trait and no category, so the
      // category is derived from the dictionary and both selects are live,
      // which is what makes the filter visible and clearable.
      await expect(categorySelect).toHaveValue(CATEGORY_KEY);
      const traitSelect = page.getByLabel('Trait', { exact: true });
      await expect(traitSelect).toBeEnabled();
      await expect(traitSelect).toHaveValue(trait.id);
      const hasData = page.getByRole('radio', { name: 'Has data' });
      const missingData = page.getByRole('radio', { name: 'Missing data' });
      await expect(missingData).toBeChecked();
      await expect(hasData).not.toBeChecked();
      await expect(hasData).toBeEnabled();

      await page.getByLabel('Search species').fill(prefix);

      // ── …and the list answers with the species that has no data for it ───
      await expect(page.getByRole('link', { name: missingName, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: coveredName, exact: true })).toHaveCount(0);
      // The Records column is shown exactly while a trait filter is set.
      await expect(recordsHeader).toBeVisible();
      // Columns in order: Species, Family, Genus, Traits, Records, Match.
      const missingRow = page.getByRole('row').filter({ hasText: missingName });
      await expect(missingRow.getByRole('cell').nth(3)).toHaveText('0');
      // RFC-60 R6: traitRecordCount is 0 in missing mode, never a dash.
      await expect(missingRow.getByRole('cell').nth(4)).toHaveText('0');

      // ── Opening it puts its name at the end of the breadcrumb ─────────────
      await page.getByRole('link', { name: missingName, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/app/species/${missingSpecies.id}(\\?|$)`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(missingName);
      // RFC-13 R3: `Data › Species › <name>`, the first two linking back and
      // the registered crumb ending the trail as text.
      const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(trail.getByRole('link', { name: 'Data', exact: true })).toBeVisible();
      await expect(trail.getByRole('link', { name: 'Species', exact: true })).toBeVisible();
      await expect(trail.locator('[aria-current="page"]')).toHaveText(missingName);

      // ── The other side of the same filter, and clearing it ───────────────
      await page.goto(deepLink);
      await page.getByLabel('Search species').fill(prefix);
      await page.getByRole('radio', { name: 'Has data' }).check();
      // The page writes the whole search to the address bar on the same
      // 300ms debounce the name waits for, so a filter changed just after a
      // `fill` reaches the URL late by up to that much: every URL-param
      // assertion in this file has to stay an `expect.poll` and must not
      // become a bare `expect`, which would read the address bar before the
      // page has finished writing it.
      await expect.poll(() => param(page, 'traitData')).toBe('with');
      await expect(page.getByRole('link', { name: coveredName, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: missingName, exact: true })).toHaveCount(0);
      const coveredRow = page.getByRole('row').filter({ hasText: coveredName });
      await expect(coveredRow.getByRole('cell').nth(3)).toHaveText('1');
      await expect(coveredRow.getByRole('cell').nth(4)).toHaveText('1');

      // Going back to "All categories" clears the derived category, the trait
      // and the mode together: none of the three survives in the URL.
      await categorySelect.selectOption({ label: 'All categories' });
      await expect.poll(() => param(page, 'traitId')).toBeNull();
      await expect.poll(() => param(page, 'traitData')).toBeNull();
      await expect.poll(() => param(page, 'categoryKey')).toBeNull();
      await expect(recordsHeader).toHaveCount(0);
      await expect(page.getByRole('link', { name: missingName, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: coveredName, exact: true })).toBeVisible();
    } finally {
      await admin.close();
    }
  });
});

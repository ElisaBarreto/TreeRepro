import { type BrowserContext, expect, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { searchSpecies } from './species-search.ts';
import { adminContext } from './users.ts';

interface SpeciesRow {
  id: string;
}

/** Seeds through the API as the administrator; a refusal fails here, where it can still be read, rather than as a locator timing out later. */
async function create<T>(admin: BrowserContext, path: string, body: unknown): Promise<T> {
  const answer = await apiCall<{ data: T }>(admin, 'POST', path, body);
  if (answer.status !== 201 || !answer.json) {
    throw new Error(`POST ${path} answered ${answer.status}`);
  }
  return answer.json.data;
}

test.describe('RFC-60 R4, R6 synonym added through the UI, found by the two-tier search (plan 10b)', () => {
  test('a synonym added on the species page is later found by name, with a "found as" line and a synonym badge', async ({
    browser,
  }) => {
    // Reuses the seeded administrator's session (no invite-accept spent):
    // `admin` always holds `taxa.manage` (RFC-31 R2), which is what shows
    // the "Add name" action on the species page.
    const admin = await adminContext(browser);

    try {
      const stamp = Date.now();
      const canonicalName = `E2E Synonym Canonical ${stamp}`;
      const synonymName = `E2E Synonym Alternate ${stamp}`;

      const species = await create<SpeciesRow>(admin, '/api/species', {
        canonicalName,
        nameSource: 'wcvp',
      });

      const page = await admin.newPage();

      // ── Add the synonym through the species page's own dialog ────────────
      await page.goto(`/app/species/${species.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(canonicalName);
      await page.getByRole('button', { name: 'Add name', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add alternative name' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Name', { exact: true }).fill(synonymName);
      // `AddNameDialog`'s Type select: NAME_TYPE_LABELS['synonym'] = 'Synonym'
      // (apps/web/src/lib/format.ts).
      await dialog.getByLabel('Type', { exact: true }).selectOption({ label: 'Synonym' });
      await dialog.getByRole('button', { name: 'Add name', exact: true }).click();
      await expect(dialog).toHaveCount(0);

      // ── Search by the synonym text finds the species, not by its own name ─
      await page.goto('/app/species');
      await searchSpecies(page, synonymName);

      const row = page.getByRole('row').filter({ hasText: canonicalName });
      await expect(row.getByRole('link', { name: canonicalName, exact: true })).toBeVisible();
      // `SpeciesList.tsx`: `found as: <em>{matchedName}</em>` plus a `Chip`
      // reading the lower-case type label (RFC-60 R6; spec §5's corrected
      // example, no language on this badge).
      await expect(row.getByText(`found as: ${synonymName}`)).toBeVisible();
      await expect(row.getByText('synonym', { exact: true })).toBeVisible();
    } finally {
      await admin.close();
    }
  });
});

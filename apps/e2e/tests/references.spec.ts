import { type BrowserContext, expect, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext } from './users.ts';

/**
 * The category the trait below is created in. `POST /api/traits` refuses a
 * category the dictionary does not already hold and no route adds one, so it
 * has to be a key `scripts/e2e.sh` seeded from
 * `apps/api/seed/trait-dictionary.csv` (the same key `browsing.spec.ts` uses).
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

test.describe('RFC-61 R4, R8, R9 the reference page: DOI link and trait chips (plan 10d)', () => {
  test('the reference page links its DOI to the registry and a trait chip opens the trait page', async ({
    browser,
  }) => {
    // Reuses the seeded administrator's session (no invite-accept spent).
    const admin = await adminContext(browser);

    try {
      const stamp = Date.now();
      const speciesName = `E2E Reference Species ${stamp}`;
      const doi = `10.1234/e2e-references-${stamp}`;
      const traitKey = `e2e_reference_${stamp}`;
      // `humaniseKey` (apps/web/src/lib/format.ts) is the only transform
      // between the stored key and the trait chip's text.
      const traitName = traitKey.replaceAll('_', ' ');

      const species = await create<SpeciesRow>(admin, '/api/species', {
        canonicalName: speciesName,
        nameSource: 'wcvp',
      });
      const reference = await create<ReferenceRow>(admin, '/api/references', {
        citationKey: `E2E-DOI-${stamp}`,
        title: 'Enriched references of E2E trees',
        year: 2026,
        doi,
      });
      let trait = await create<TraitRow>(admin, '/api/traits', {
        key: traitKey,
        categoryKey: CATEGORY_KEY,
        valueType: 'categorical',
        description: 'Whether this species has any record at all for the trait.',
      });
      trait = await create<TraitRow>(admin, `/api/traits/${trait.id}/levels`, {
        key: 'e2e_present',
      });
      const level = trait.levels.find((candidate) => candidate.key === 'e2e_present');
      if (!level) {
        throw new Error(`the trait came back with levels ${trait.levels.map((l) => l.key)}`);
      }
      // A harmonised record citing the reference for this trait — the
      // `trait_records` insert trigger is what fills `reference_traits`
      // (RFC-61 R9), the count the page's trait chip reads.
      await create<CreatedRecords>(admin, '/api/records', {
        speciesId: species.id,
        traitId: trait.id,
        value: { levelId: level.id },
        sources: { references: [{ id: reference.id }] },
      });

      const page = await admin.newPage();
      await page.goto(`/app/references/${reference.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(`E2E-DOI-${stamp}`);

      // ── The DOI opens the registry in a new tab (RFC-80 R4) ───────────────
      // `ReferencePage.tsx`'s `metadataRows`: the DOI row's `dd` holds an
      // `ExternalLink` reading the raw DOI, `href` built by `doiHref`.
      const doiLink = page.locator('dt:text-is("DOI") + dd a', { hasText: doi });
      await expect(doiLink).toHaveAttribute('href', `https://doi.org/${doi}`);
      await expect(doiLink).toHaveAttribute('target', '_blank');
      await expect(doiLink).toHaveAttribute('rel', 'noopener noreferrer');

      // ── A trait chip names the trait and how many records use it, and
      // opens the trait page ────────────────────────────────────────────────
      const traitsSection = page.getByRole('list', { name: 'Traits' });
      const traitChip = traitsSection.getByRole('link', { name: new RegExp(traitName) });
      await expect(traitChip).toContainText(traitName);
      await expect(traitChip).toContainText('1 record');
      await traitChip.click();
      await expect(page).toHaveURL(new RegExp(`/app/traits/${trait.id}(\\?|$)`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(traitName);
    } finally {
      await admin.close();
    }
  });
});

import { type BrowserContext, expect, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext, inviteAndActivate } from './users.ts';

/**
 * The broad category the trait below is created in. `createTrait` refuses a
 * category the dictionary does not already hold and there is no endpoint to
 * add one, so this has to be a key `scripts/e2e.sh` seeded from
 * `apps/api/seed/trait-dictionary.csv` — the same one `contribution.spec.ts`
 * and `contributions.spec.ts` use.
 */
const CATEGORY_KEY = 'reproduction';

interface SpeciesRow {
  id: string;
}
interface PlotRow {
  id: string;
}
interface TraitRow {
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

/** A dictionary key as the web app writes it (`humaniseKey`): underscores become spaces. */
function humanised(key: string): string {
  return key.replaceAll('_', ' ');
}

test.describe('RFC-72 workspace dashboard (plan 11b)', () => {
  test('a contributor sees their plot, a missing trait and an awaiting record; validating it drops the count after a refetch', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const stamp = Date.now();
    const speciesName = `E2E Dashboard ${stamp}`;
    const plotCode = `PLT-DASH-${stamp.toString().slice(-8)}`;
    const plotName = `E2E Dashboard Plot ${stamp}`;
    const traitKey = `e2e_dashboard_${stamp}`;
    const traitName = humanised(traitKey);

    // ── Seed one species and one plot holding only it, plus a trait new to
    // the dictionary — everything timestamped so nothing here can collide
    // with another branch's fixtures or with dataset-wide activity. ────────
    const species = await create<SpeciesRow>(admin, '/api/species', {
      canonicalName: speciesName,
      nameSource: 'wcvp',
    });
    const plot = await create<PlotRow>(admin, '/api/plots', { code: plotCode, name: plotName });
    const memberAdded = await apiCall(admin, 'POST', `/api/plots/${plot.id}/species`, {
      speciesId: species.id,
    });
    expect(memberAdded.status).toBe(201);
    const trait = await create<TraitRow>(admin, '/api/traits', {
      key: traitKey,
      categoryKey: CATEGORY_KEY,
      valueType: 'quantitative',
      description: 'A quantitative trait created for the workspace dashboard E2E.',
    });

    const contributor = await inviteAndActivate(browser, admin, { role: 'contributor' });

    try {
      const assigned = await apiCall(admin, 'PUT', `/api/admin/users/${contributor.userId}/plots`, {
        plotIds: [plot.id],
        restrictToAssignedPlots: true,
      });
      expect(assigned.status).toBe(200);

      // The record awaiting validation is the contributor's own — a personal
      // observation, so no admin-created reference is needed — created
      // through the API after the plot assignment above. `POST /api/records`
      // drops the caller's own `dashboard:<id>` cache entry (RFC-72 R1), the
      // only thing that makes the plot assignment visible on the next
      // dashboard fetch: nothing invalidates that cache when a user's plots
      // change, so the contributor's own two page loads earlier in
      // `inviteAndActivate` (both before this plot existed for them) would
      // otherwise still be served back on the next load below. Authorship
      // does not matter to "awaiting" (RFC-72 R1: no confirm annotation from
      // anyone, no withdraw), so this is still a faithful fixture, not a
      // workaround dressed as one.
      const recordCreated = await apiCall(contributor.context, 'POST', '/api/records', {
        speciesId: species.id,
        traitId: trait.id,
        value: { numeric: 12.5 },
        sources: { personalObservation: true },
      });
      expect(recordCreated.status).toBe(201);

      const page = contributor.page;
      await page.goto('/app/');

      // ── Your scope: the plot, with its one species. ───────────────────
      await expect(page.getByRole('heading', { name: 'Your scope' })).toBeVisible();
      await expect(page.getByText(`${plotName} · 1 species`)).toBeVisible();

      // ── Top traits missing data in your plots: the lone species in the
      // plot has no record for any trait but the one just seeded, so every
      // ranked entry reads "1 species" — asserted without naming which
      // trait wins the tie, since that is dataset-wide and not this test's
      // to pin down. ──────────────────────────────────────────────────────
      const missingSection = page.getByRole('region', {
        name: 'Top traits missing data in your plots',
      });
      await expect(missingSection).toBeVisible();
      await expect(missingSection.getByText('1 species').first()).toBeVisible();

      // ── Records awaiting your validation: the one record just seeded. ──
      await expect(
        page.getByRole('heading', { name: 'Records awaiting your validation (1)' }),
      ).toBeVisible();
      const row = page.getByRole('row').filter({ hasText: speciesName });
      await expect(row).toContainText(traitName);
      await expect(row.getByRole('link', { name: 'Personal observation' })).toBeVisible();
      await row.getByRole('button', { name: '12.5', exact: true }).click();

      // ── Validate it from the record drawer. ─────────────────────────────
      const drawer = page.getByRole('dialog', { name: 'Record', exact: true });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: '✓ Validate', exact: true }).click();
      await expect(drawer.getByText('You validated this record')).toBeVisible();
      await drawer.getByRole('button', { name: 'Close' }).click();

      // ── Validating drops the record's own cache entry the same way the
      // seeding write above did, but the page itself only asks for the
      // dashboard once, on mount — seeing the drop takes a fresh navigation,
      // not a wait on the still-mounted query. ────────────────────────────
      await page.goto('/app/');
      await expect(
        page.getByRole('heading', { name: 'Records awaiting your validation (0)' }),
      ).toBeVisible();
      await expect(page.getByText('Everything in your plots has been validated.')).toBeVisible();
    } finally {
      await contributor.context.close();
      await admin.close();
    }
  });
});

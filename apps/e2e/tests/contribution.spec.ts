import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext, inviteAndActivate } from './users.ts';

/**
 * The broad category the traits below are created in. `createTrait` refuses a
 * category the dictionary does not already hold and there is no endpoint to
 * add one, so this has to be a key `scripts/e2e.sh` seeded from
 * `apps/api/seed/trait-dictionary.csv`.
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

/**
 * The trait card's own button, the one that opens the trait's records. The
 * `?` ("What does <trait> mean?"), the `+` ("Add value for <trait>") and the
 * level buttons ("Validate <level> for <trait>") carry the name too, but only
 * the card's own starts with it.
 */
function traitCard(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name}`) });
}

/** A dictionary key as the web app writes it (`humaniseKey`). */
function humanised(key: string): string {
  return key.replaceAll('_', ' ');
}

const CONTEST = 'Contest — The existing value is wrong; mine should replace it.';
const COMPLEMENT =
  'Complement — The existing value is also correct; I am adding another observation.';

test.describe('RFC-70 contributor workflow (plan 09b)', () => {
  test('a contributor validates and contests a level from its card, must say contest or complement first, and adds the first entry for a trait with no data', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const stamp = Date.now();
    const speciesName = `E2E Contribution ${stamp}`;
    const contributorName = `E2E Contributor ${stamp}`;
    // Two traits: one that already carries a record (validated, then
    // contested) and one the species has nothing for ("traits with no data").
    const recordedKey = `e2e_recorded_${stamp}`;
    const untouchedKey = `e2e_untouched_${stamp}`;
    const recordedName = humanised(recordedKey);
    const untouchedName = humanised(untouchedKey);

    const species = await create<SpeciesRow>(admin, '/api/species', {
      canonicalName: speciesName,
      nameSource: 'wcvp',
    });
    // A publication, so the seeded record's article is plainly not the
    // personal observation the contest creates further down.
    const reference = await create<ReferenceRow>(admin, '/api/references', {
      citationKey: `E2E-${stamp}`,
      title: 'Breeding systems of E2E trees',
      year: 2026,
    });
    let recorded = await create<TraitRow>(admin, '/api/traits', {
      key: recordedKey,
      categoryKey: CATEGORY_KEY,
      valueType: 'categorical',
      description: 'How this trait is distributed among individuals.',
    });
    // Each level answers the whole trait back, so the second call carries both.
    await create<TraitRow>(admin, `/api/traits/${recorded.id}/levels`, { key: 'e2e_seeded' });
    recorded = await create<TraitRow>(admin, `/api/traits/${recorded.id}/levels`, {
      key: 'e2e_contested',
    });
    const seededLevel = recorded.levels.find((level) => level.key === 'e2e_seeded');
    const contestedLevel = recorded.levels.find((level) => level.key === 'e2e_contested');
    if (!seededLevel || !contestedLevel) {
      throw new Error(`the trait came back with levels ${recorded.levels.map((l) => l.key)}`);
    }
    await create<TraitRow>(admin, '/api/traits', {
      key: untouchedKey,
      categoryKey: CATEGORY_KEY,
      valueType: 'quantitative',
      unit: 'mm',
      description: 'How long this trait is.',
    });
    await create<CreatedRecords>(admin, '/api/records', {
      speciesId: species.id,
      traitId: recorded.id,
      value: { levelIds: [seededLevel.id] },
      sources: { references: [{ id: reference.id }] },
    });

    const contributor = await inviteAndActivate(browser, admin, {
      role: 'contributor',
      name: contributorName,
    });
    const page = contributor.page;

    try {
      // ── The contributor validates the seeded level from its card (spec §2, R-6) ──
      await page.goto(`/app/species/${species.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(speciesName);
      await expect(page.getByRole('list', { name: 'Legend' })).toContainText('Validate');
      await page
        .getByRole('button', {
          name: `Validate ${seededLevel.key} for ${recordedName}`,
          exact: true,
        })
        .click();
      const validate = page.getByRole('dialog', { name: `Validate ${seededLevel.key}` });
      await expect(validate.getByText('Do you confirm that this record is correct?')).toBeVisible();
      await validate.getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(validate).toBeHidden();
      const levels = page.getByRole('list', { name: `Levels of ${recordedName}` });
      await expect(levels.getByRole('listitem').filter({ hasText: seededLevel.key })).toContainText(
        '✓ 1',
      );

      // ── …then contests it from the same row, as a personal observation ──
      await page
        .getByRole('button', {
          name: `Contest ${seededLevel.key} for ${recordedName}`,
          exact: true,
        })
        .click();
      const contest = page.getByRole('dialog', { name: `Add entries for ${recordedName}` });
      await expect(contest.getByRole('radio', { name: CONTEST })).toBeChecked();
      await contest.getByRole('checkbox', { name: contestedLevel.key }).check();
      // Every categorical entry with a non-empty E shows what it will do per
      // level behind a required confirmation (RFC-70 R10): here E is the
      // seeded level alone (the contested level has no record yet), so the
      // seeded level is contested and the checked one is added.
      const confirmContest = contest.getByRole('checkbox', {
        name: `Confirm: Contest ${seededLevel.key} · Add ${contestedLevel.key}`,
      });
      await expect(confirmContest).toBeVisible();
      await confirmContest.check();
      await contest.getByRole('button', { name: 'Add record(s)', exact: true }).click();
      await expect(contest).toBeHidden();

      // RFC-70 R3: the record the API created opens in the drawer, badged
      // with what it says about the record it answers. A categorical contest
      // answers no single record (RFC-63 R14), so the drawer badges its
      // intent alone (RFC-70 R6, 13g's pair).
      const drawer = page.getByRole('dialog', { name: 'Record', exact: true });
      await expect(drawer.getByText('contest', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: /^contests record/ })).toHaveCount(0);
      await expect(drawer.getByText(contestedLevel.key, { exact: true }).first()).toBeVisible();
      const observation = drawer.getByRole('link', {
        name: `Personal observation (${contributorName})`,
        exact: true,
      });
      await expect(observation).toBeVisible();
      await observation.click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Personal observation (${contributorName})`,
      );

      // ── The card's own + asks Contest or Complement first (item 2.1) ─────
      await page.goto(`/app/species/${species.id}`);
      await page
        .getByRole('button', { name: `Add value for ${recordedName}`, exact: true })
        .click();
      const entry = page.getByRole('dialog', { name: `Add entries for ${recordedName}` });
      await expect(entry.getByRole('checkbox', { name: seededLevel.key })).toBeDisabled();
      await expect(
        entry.getByRole('button', { name: 'Add record(s)', exact: true }),
      ).toBeDisabled();
      await entry.getByRole('radio', { name: COMPLEMENT }).check();
      await entry.getByLabel('Responding to').selectOption({ label: seededLevel.key });
      await expect(entry.getByRole('checkbox', { name: seededLevel.key })).toBeEnabled();
      await entry.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(entry).toBeHidden();

      // ── …and records the first entry for a trait with no data ────────────
      await expect(traitCard(page, recordedName)).toBeVisible();
      await expect(page.getByText(untouchedName)).toHaveCount(0);
      await page.getByRole('checkbox', { name: 'Show traits with no data' }).check();

      const emptyCard = page.locator('div').filter({ hasText: untouchedName }).last();
      await expect(emptyCard.getByText('No records yet')).toBeVisible();
      await emptyCard.getByRole('button', { name: 'Add the first entry' }).click();

      const entries = page.getByRole('dialog', {
        name: `Add entries for ${untouchedName} (mm)`,
      });
      await entries.getByLabel('Single value (mm)').fill('12.5');
      await entries.getByRole('button', { name: 'Add record(s)', exact: true }).click();

      await expect(entries).toBeHidden();
      // R-2: a record created on the platform takes a TR_ code.
      await expect(drawer.getByText('Record ID')).toBeVisible();
      await expect(drawer.getByText(/^TR_\d+[a-z]*$/)).toBeVisible();
      await drawer.getByRole('button', { name: 'Close' }).click();

      await expect(traitCard(page, untouchedName)).toContainText('1 record');
    } finally {
      await contributor.context.close();
      await admin.close();
    }
  });
});

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
 * `?` beside it ("What does <trait> mean?") and the `+` ("Add value for
 * <trait>") carry the trait's name too, so the name alone matches three
 * buttons; only the card's own starts with it. The keys this file creates are
 * letters, digits and underscores, so nothing in them is a regular-expression
 * metacharacter.
 */
function traitCard(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name}`) });
}

/** A dictionary key as the web app writes it (`humaniseKey`). */
function humanised(key: string): string {
  return key.replaceAll('_', ' ');
}

test.describe('RFC-70 contributor workflow (plan 09b)', () => {
  test('a contributor validates a record, contests it as a personal observation, and adds the first entry for a trait with no data', async ({
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
      value: { levelId: seededLevel.id },
      sources: { references: [{ id: reference.id }] },
    });

    const contributor = await inviteAndActivate(browser, admin, {
      role: 'contributor',
      name: contributorName,
    });
    const page = contributor.page;

    try {
      // ── The contributor opens the record and agrees with it ──────────────
      await page.goto(`/app/species/${species.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(speciesName);
      await traitCard(page, recordedName).click();

      const panel = page.getByRole('dialog', { name: recordedName });
      await panel.getByRole('button', { name: seededLevel.key, exact: true }).click();

      // exact: true throughout — "Record" is a substring of the contest
      // dialog's own title, and "Validate" of its help tip's label.
      const drawer = page.getByRole('dialog', { name: 'Record', exact: true });
      await expect(drawer.getByRole('link', { name: `E2E-${stamp}` })).toBeVisible();
      await drawer.getByRole('button', { name: '✓ Validate', exact: true }).click();

      // RFC-70 R4: the confirmation is attached to the record and the button
      // is out of reach, because the viewer's own latest stance is now
      // `confirm`.
      await expect(drawer.getByText('You validated this record')).toBeVisible();
      await expect(drawer.getByRole('button', { name: '✓ Validate', exact: true })).toBeDisabled();
      await expect(drawer.getByText('confirm', { exact: true })).toBeVisible();

      // ── …then contests it with a value of their own ──────────────────────
      await drawer.getByRole('button', { name: '+ Add different record', exact: true }).click();
      const contest = page.getByRole('dialog', {
        name: `Add a different record for ${recordedName} of ${speciesName}`,
      });
      await contest
        .getByRole('radio', {
          name: 'Contest — The existing value is wrong; mine should replace it.',
        })
        .check();
      await contest.getByLabel('Level').selectOption({ label: contestedLevel.key });
      // No DOI at all: RFC-80 R5 records the claim under the contributor's
      // own personal-observation reference. (The stack has no network, so a
      // DOI could not resolve here in any case.)
      await expect(
        contest.getByText('This will be recorded as your personal observation'),
      ).toBeVisible();
      await contest.getByRole('button', { name: 'Add record', exact: true }).click();

      // RFC-70 R3: the record the API created opens in the drawer the contest
      // was started from, badged with what it says about the record it answers.
      await expect(contest).toBeHidden();
      await expect(drawer.getByRole('button', { name: /^contests record/ })).toBeVisible();
      await expect(drawer.getByText(contestedLevel.key, { exact: true }).first()).toBeVisible();

      const observation = drawer.getByRole('link', {
        name: `Personal observation (${contributorName})`,
        exact: true,
      });
      await expect(observation).toBeVisible();
      // RFC-61 R7: the reference itself names its observer — the citation key
      // (`personal-observation:<user id>`) is never shown.
      await observation.click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Personal observation (${contributorName})`,
      );

      // ── …and records the first entry for a trait with no data ────────────
      await page.goto(`/app/species/${species.id}`);
      // The recorded trait's card first, so the summary has demonstrably
      // arrived: without the flag it lists the traits that have records only,
      // and the absence below would otherwise also hold while it loads.
      await expect(traitCard(page, recordedName)).toBeVisible();
      await expect(page.getByText(untouchedName)).toHaveCount(0);
      await page.getByRole('checkbox', { name: 'Show traits with no data' }).check();

      // RFC-70 R7 lists every active trait the species has no record for, so
      // "Add the first entry" repeats across the page: the one wanted is the
      // one inside the card that names this trait (the innermost `div` holding
      // the name is the card's own body).
      const emptyCard = page.locator('div').filter({ hasText: untouchedName }).last();
      await expect(emptyCard.getByText('No records yet')).toBeVisible();
      await emptyCard.getByRole('button', { name: 'Add the first entry' }).click();

      const entries = page.getByRole('dialog', {
        name: `Add entries for ${untouchedName} (mm)`,
      });
      await entries.getByLabel('Number (mm)').fill('12.5');
      await entries.getByRole('button', { name: 'Add record(s)', exact: true }).click();

      await expect(entries).toBeHidden();
      await expect(drawer.getByText('12.5 mm')).toBeVisible();
      await drawer.getByRole('button', { name: 'Close' }).click();

      // The card is no longer empty: the summary the write invalidated now
      // counts the record, so the trait renders as an ordinary trait card.
      await expect(traitCard(page, untouchedName)).toContainText('1 record');
    } finally {
      await contributor.context.close();
      await admin.close();
    }
  });
});

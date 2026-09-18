import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { apiCall } from './api.ts';
import { adminContext, inviteAndActivate } from './users.ts';

/**
 * The broad category the trait below is created in. `createTrait` refuses a
 * category the dictionary does not already hold and there is no endpoint to
 * add one, so this has to be a key `scripts/e2e.sh` seeded from
 * `apps/api/seed/trait-dictionary.csv` — the same one `contribution.spec.ts`
 * uses.
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
 * buttons; only the card's own starts with it. The key this file creates is
 * letters, digits and underscores, so nothing in it is a regular-expression
 * metacharacter.
 */
function traitCard(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name}`) });
}

/** A dictionary key as the web app writes it (`humaniseKey`). */
function humanised(key: string): string {
  return key.replaceAll('_', ' ');
}

test.describe('RFC-71 my contributions (plan 11a)', () => {
  test('after validating and contesting a record, the contributor finds both on My contributions', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const stamp = Date.now();
    const speciesName = `E2E My Contributions ${stamp}`;
    const contributorName = `E2E Contributor MC ${stamp}`;
    const traitKey = `e2e_mycontrib_${stamp}`;
    const traitName = humanised(traitKey);

    const species = await create<SpeciesRow>(admin, '/api/species', {
      canonicalName: speciesName,
      nameSource: 'wcvp',
    });
    // A publication, so the seeded record's article is plainly not the
    // personal observation the contest creates further down.
    const reference = await create<ReferenceRow>(admin, '/api/references', {
      citationKey: `E2EMC-${stamp}`,
      title: 'Reproductive traits for the My contributions E2E',
      year: 2026,
    });
    let trait = await create<TraitRow>(admin, '/api/traits', {
      key: traitKey,
      categoryKey: CATEGORY_KEY,
      valueType: 'categorical',
      description: 'How this trait is distributed among individuals.',
    });
    // Each level answers the whole trait back, so the second call carries both.
    await create<TraitRow>(admin, `/api/traits/${trait.id}/levels`, { key: 'e2e_seeded' });
    trait = await create<TraitRow>(admin, `/api/traits/${trait.id}/levels`, {
      key: 'e2e_contested',
    });
    const seededLevel = trait.levels.find((level) => level.key === 'e2e_seeded');
    const contestedLevel = trait.levels.find((level) => level.key === 'e2e_contested');
    if (!seededLevel || !contestedLevel) {
      throw new Error(`the trait came back with levels ${trait.levels.map((l) => l.key)}`);
    }
    await create<CreatedRecords>(admin, '/api/records', {
      speciesId: species.id,
      traitId: trait.id,
      value: { levelId: seededLevel.id },
      sources: { references: [{ id: reference.id }] },
    });

    const contributor = await inviteAndActivate(browser, admin, {
      role: 'contributor',
      name: contributorName,
    });
    const page = contributor.page;

    try {
      // ── The contributor validates the seeded record… ─────────────────────
      await page.goto(`/app/species/${species.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(speciesName);
      await traitCard(page, traitName).click();

      const panel = page.getByRole('dialog', { name: traitName });
      await panel.getByRole('button', { name: seededLevel.key, exact: true }).click();

      const drawer = page.getByRole('dialog', { name: 'Record', exact: true });
      await drawer.getByRole('button', { name: '✓ Validate', exact: true }).click();
      // RFC-70 R4: the confirmation is attached to the record.
      await expect(drawer.getByText('You validated this record')).toBeVisible();

      // ── …then contests it with a value of their own. RFC-70 R3 inserts a
      // `dispute` annotation on the seeded record, generated in the
      // contributor's own name, so the contributor ends this step with one
      // manual record (the contest), one `confirm` annotation (the
      // validation) and one `dispute` annotation (generated) — all three of
      // RFC-71 R4's non-zero counts below. ──────────────────────────────────
      await drawer.getByRole('button', { name: '+ Add different record', exact: true }).click();
      const contest = page.getByRole('dialog', {
        name: `Add a different record for ${traitName} of ${speciesName}`,
      });
      await contest
        .getByRole('radio', {
          name: 'Contest — The existing value is wrong; mine should replace it.',
        })
        .check();
      await contest.getByLabel('Level').selectOption({ label: contestedLevel.key });
      await contest.getByRole('button', { name: 'Add record', exact: true }).click();
      await expect(contest).toBeHidden();

      // ── …and both show up on My contributions (RFC-71) ───────────────────
      await page.goto('/app/contributions');
      await expect(page.getByRole('heading', { name: 'My contributions' })).toBeVisible();

      // R4: the summary tiles count the record, its contest intent, the
      // validation and the generated dispute — this fresh contributor has
      // done nothing else, so every other count stays zero. Label and value
      // are pinned separately (as StatTiles.test.tsx does with
      // toHaveTextContent), not as one exact string of the two stacked
      // elements a tile renders.
      const tiles = page.getByRole('list', { name: 'Summary' });
      const tile = (label: string) => tiles.getByRole('listitem').filter({ hasText: label });
      const tileShows = async (label: string, value: string) => {
        const item = tile(label);
        await expect(item).toContainText(label);
        await expect(item).toContainText(value);
      };
      await tileShows('Records', '1');
      await tileShows('Contests', '1');
      await tileShows('Complements', '0');
      await tileShows('Validations', '1');
      await tileShows('Disputes', '1');
      await tileShows('Withdrawn', '0');
      await tileShows('Accepted', '0');

      // R2: the Records tab (open by default) lists the contest as the
      // contributor's own manual record, badged with its intent; it is not
      // the accepted value.
      const recordsTable = page.getByRole('table');
      const recordRow = recordsTable.getByRole('row').filter({ hasText: speciesName });
      await expect(recordRow).toContainText(traitName);
      await expect(recordRow.getByText('contest', { exact: true })).toBeVisible();
      await expect(recordRow.getByText('accepted', { exact: true })).toHaveCount(0);

      // R3: the Annotations tab lists both annotations the contributor wrote
      // on the seeded record — the validation and the dispute the contest
      // generated in their name — each naming the species and the trait.
      await page.getByRole('link', { name: 'Annotations' }).click();
      const annotationRows = page
        .getByRole('table')
        .getByRole('row')
        .filter({ hasText: `${speciesName} › ${traitName}` });
      await expect(annotationRows).toHaveCount(2);

      const validation = annotationRows.filter({ hasText: 'confirm' });
      const generatedDispute = annotationRows.filter({ hasText: 'dispute' });
      await expect(validation).toHaveCount(1);
      await expect(generatedDispute).toHaveCount(1);
      await expect(validation.getByText('automatic')).toHaveCount(0);
      await expect(generatedDispute.getByText('automatic')).toBeVisible();
      await expect(generatedDispute).toContainText('Contested by record');

      // An annotation row's button reopens the record it names — the seeded
      // record here, still. That is not "You validated this record" any
      // more: RecordActions keys `validated` off the contributor's *newest*
      // non-withdraw stance, and the contest's generated dispute (RFC-70 R3)
      // has since overtaken the earlier confirm, so Validate is enabled
      // again and the span is gone. The review badge is computed the same
      // way, from every annotation on the record, so it now reads disputed.
      await validation.getByRole('button', { name: `${speciesName} › ${traitName}` }).click();
      const reopened = page.getByRole('dialog', { name: 'Record', exact: true });
      await expect(reopened.getByText('disputed', { exact: true })).toBeVisible();
    } finally {
      await contributor.context.close();
      await admin.close();
    }
  });
});

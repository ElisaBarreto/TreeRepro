import { expect, test } from '@playwright/test';
import { adminContext, inviteAndActivate } from './users.ts';

test.describe('RFC-75 species proposals / RFC-81 taxonomy lookup (plan 12c)', () => {
  test('a contributor proposes a species, an admin approves it from the queue, and it shows up on the Proposals tab of My contributions', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const adminPage = await admin.newPage();

    const stamp = Date.now();
    const speciesName = `E2E Proposal ${stamp}`;
    const contributorName = `E2E Proposer ${stamp}`;

    const contributor = await inviteAndActivate(browser, admin, {
      role: 'contributor',
      name: contributorName,
    });
    const page = contributor.page;

    try {
      // ── The contributor searches for a species that is not in the catalog
      // and proposes it ────────────────────────────────────────────────────
      await page.goto('/app/species');
      await expect(page.getByRole('heading', { name: 'Species', level: 1 })).toBeVisible();
      await page.getByLabel('Search species').fill(speciesName);

      const proposeButton = page.getByRole('button', { name: 'Propose this species' });
      await expect(proposeButton).toBeVisible();
      await proposeButton.click();

      const proposeDialog = page.getByRole('dialog', { name: 'Propose a species' });
      await expect(proposeDialog.getByLabel('Species name')).toHaveValue(speciesName);
      await proposeDialog.getByLabel('Note (optional)').fill('Seen in the E2E test plot.');
      await proposeDialog.getByRole('button', { name: 'Propose', exact: true }).click();

      // The stack has no outbound network and leaves WCVP_GBIF_DATASET_KEY
      // unset (E2E stack constraint), so the lookup stores `null` — nothing
      // here waits on or asserts a match; that is proven below, from the
      // stored `lookup`, not recomputed.
      await expect(proposeDialog).toBeHidden();

      // ── The admin opens the queue, sees the lookup verdict is "lookup
      // failed" (RFC-81 R3's `failed`, not `none`: the call never completed,
      // it did not run and find nothing), and approves it ───────────────────
      await adminPage.goto('/app/curation/proposals');
      await expect(
        adminPage.getByRole('heading', { name: 'Species proposals', level: 1 }),
      ).toBeVisible();

      const table = adminPage.getByRole('table');
      const row = table.getByRole('row').filter({ hasText: speciesName });
      await expect(row).toBeVisible();
      // R-K: `failed` means every attempted call failed (here, none could be
      // attempted at all) — distinct from `none`, which means GBIF answered
      // and found nothing. The badge text is asserted verbatim against
      // apps/web/src/components/curation/LookupCard.tsx's VERDICT_LABELS.
      await expect(row.getByText('lookup failed', { exact: true })).toBeVisible();

      await row.getByRole('button', { name: speciesName, exact: true }).click();

      const drawer = adminPage.getByRole('dialog', { name: 'Proposal', exact: true });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('lookup failed', { exact: true })).toBeVisible();
      await expect(
        drawer.getByText(
          'The lookup could not be completed, so nothing was checked against GBIF. This says nothing about the name.',
        ),
      ).toBeVisible();

      await drawer.getByRole('button', { name: 'Approve', exact: true }).click();

      const approveDialog = adminPage.getByRole('dialog', { name: 'Approve proposal' });
      await expect(approveDialog).toBeVisible();
      // Prefilled from a `null` lookup (RFC-75 R4 / proposal-prefill.ts): the
      // proposed name verbatim, source "original" — nothing here was matched
      // against GBIF, so nothing here is attributed to GBIF or WCVP.
      await expect(approveDialog.getByLabel('Canonical name')).toHaveValue(speciesName);
      await expect(approveDialog.getByLabel('Name source')).toHaveValue('original');
      await approveDialog.getByRole('button', { name: 'Approve and create', exact: true }).click();

      await expect(approveDialog).toBeHidden();
      await expect(drawer).toBeHidden();
      // The decided proposal drops out of the default `status=open` queue.
      await expect(table.getByRole('row').filter({ hasText: speciesName })).toHaveCount(0);

      // ── The species now shows up on the contributor's own Proposals tab of
      // My contributions (RFC-75 R5, R6): approved, linked to the species the
      // approval created ─────────────────────────────────────────────────────
      await page.goto('/app/contributions');
      await expect(page.getByRole('heading', { name: 'My contributions' })).toBeVisible();
      await page.getByRole('link', { name: 'Proposals' }).click();

      const proposalsTable = page.getByRole('table');
      const proposalRow = proposalsTable.getByRole('row').filter({ hasText: speciesName });
      await expect(proposalRow).toBeVisible();
      await expect(proposalRow.getByText('approved', { exact: true })).toBeVisible();
      const speciesLink = proposalRow.getByRole('link', { name: speciesName, exact: true });
      await expect(speciesLink).toBeVisible();

      // Following it lands on the species the approval created.
      await speciesLink.click();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(speciesName);
    } finally {
      await contributor.context.close();
      await admin.close();
    }
  });
});

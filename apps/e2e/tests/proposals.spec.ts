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

      // WCVP_GBIF_DATASET_KEY is unset in the E2E stack (compose.e2e.yml
      // never sets it, so compose.yml's `x-api-env` default of `''` wins),
      // so only the GBIF backbone call is attempted for this stamped,
      // never-real name — nothing here waits on or asserts a match; that is
      // proven below, from the stored `lookup`, not recomputed.
      await expect(proposeDialog).toBeHidden();

      // ── The admin opens the queue and sees the lookup verdict rendered,
      // then approves it ─────────────────────────────────────────────────
      await adminPage.goto('/app/curation/proposals');
      await expect(
        adminPage.getByRole('heading', { name: 'Species proposals', level: 1 }),
      ).toBeVisible();

      const table = adminPage.getByRole('table');
      const row = table.getByRole('row').filter({ hasText: speciesName });
      await expect(row).toBeVisible();
      // The CI runner DOES have outbound network to api.gbif.org (unlike the
      // verify container used for local checks), so whether the one attempted
      // call (the backbone; WCVP is disabled above) lands as `none` — GBIF
      // reachable, answered, and does not know this stamped name, badge "not
      // found" — or `failed` — the call itself could not complete, badge
      // "lookup failed" — depends on network conditions at run time, not on
      // anything this test controls. Pinning either verdict would couple CI
      // to a third party being reachable or not; asserting neither would lose
      // proof the column renders a real verdict at all. The exact
      // `failed`-versus-`none` distinction (R-K: `failed` means nobody
      // checked, `none` means GBIF checked and found nothing) is asserted
      // deterministically against captured fixtures in
      // apps/web/src/components/curation/LookupCard.test.tsx, which is where
      // it belongs — here we only prove one of the two renders.
      const lookupCell = row.getByRole('cell').last();
      await expect(lookupCell).toHaveText(/^(not found|lookup failed)$/);

      await row.getByRole('button', { name: speciesName, exact: true }).click();

      const drawer = adminPage.getByRole('dialog', { name: 'Proposal', exact: true });
      await expect(drawer).toBeVisible();
      // Same reasoning as the row above: the drawer's badge mirrors whichever
      // of the two verdicts the queue showed.
      await expect(drawer.getByText(/^(not found|lookup failed)$/)).toBeVisible();

      await drawer.getByRole('button', { name: 'Approve', exact: true }).click();

      const approveDialog = adminPage.getByRole('dialog', { name: 'Approve proposal' });
      await expect(approveDialog).toBeVisible();
      // Prefilled the same way under either verdict (RFC-75 R4 /
      // proposal-prefill.ts): a `null` lookup and a lookup whose only
      // attempted source (the backbone) matched nothing both fail
      // `preferredSource`'s "answered with a match" test, so both fall back
      // to the proposed name verbatim, source "original" — nothing here is
      // attributed to GBIF or WCVP either way.
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

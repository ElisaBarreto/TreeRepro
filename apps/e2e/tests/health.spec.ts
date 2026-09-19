import { expect, test } from '@playwright/test';
import { adminContext } from './users.ts';

test.describe('RFC-52 platform health (plan 12d)', () => {
  test('an admin opens Health and sees the digest job row', async ({ browser }) => {
    // health.read is admin-only (spec §7, RFC-30), so the seeded
    // administrator's reused session is enough here — no second role to set
    // up, unlike the proposals/plots flows.
    const admin = await adminContext(browser);
    try {
      const page = await admin.newPage();
      await page.goto('/app/admin/health');

      // HealthPage.tsx: <PageHeader title="Platform health" ... /> renders an
      // <h1> (PageHeader.tsx).
      await expect(page.getByRole('heading', { name: 'Platform health', level: 1 })).toBeVisible();

      // The Jobs section is a <section aria-labelledby="health-jobs-heading">
      // with <h2 id="health-jobs-heading">Jobs</h2> (HealthPage.tsx:165-168),
      // which gives it an accessible name of "Jobs" and, per ARIA, the
      // implicit role "region" — the same pattern `dashboard.spec.ts` uses
      // for "Top traits missing data in your plots".
      const jobsSection = page.getByRole('region', { name: 'Jobs' });
      await expect(jobsSection).toBeVisible();

      // JobRow.tsx renders one <Tr> per job with the label in the first
      // <Td> ("Digest", HealthPage.tsx:180) and the badge span
      // (Badge.tsx:14-19) as the text of the second: "never ran" when
      // `jobs.digest` is `null` (JobRow.tsx: `if (run === null) return {
      // tone: 'neutral', label: 'never ran' }`), or, once the API
      // container's first hourly digest tick has fired (`startDigestTimer`,
      // digest.ts:696, ticks `initialDelayMs` after start, not immediately)
      // with DIGEST_ENABLED=false (compose.e2e.yml:13), "skipped" — a
      // DIGEST_ENABLED=false tick records a `skipped` run
      // (digest.ts:157) less than 26h old, which JobRow's badge rule
      // (JobRow.tsx: `ageHours <= STALE_HOURS` → green, labelled with the
      // status) renders as its own status label, not `stale`. Which of the
      // two this test sees depends on how long the API container has been
      // up when the suite reaches it, not on anything this test controls,
      // so both are accepted (plan 12d, task 4 brief) rather than pinning
      // one and coupling this spec to CI timing.
      const digestRow = jobsSection.getByRole('row').filter({ hasText: 'Digest' });
      await expect(digestRow).toBeVisible();
      const statusCell = digestRow.getByRole('cell').nth(1);
      await expect(statusCell).toHaveText(/^(never ran|skipped)$/);

      // The two statuses are also distinguishable by the Started column
      // (JobRow.tsx: `{run ? formatDateTime(run.startedAt) : DASH}`): a
      // `null` run (never ran) shows the em dash, a real `skipped` run
      // shows a formatted timestamp. Asserting this too proves the row is
      // reading the actual `jobs.digest` value rather than happening to
      // match the status regex by accident.
      const startedCell = digestRow.getByRole('cell').nth(2);
      const status = await statusCell.textContent();
      if (status === 'never ran') {
        await expect(startedCell).toHaveText('—');
      } else {
        await expect(startedCell).not.toHaveText('—');
      }
    } finally {
      await admin.close();
    }
  });
});

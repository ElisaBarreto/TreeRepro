import { expect, test } from '@playwright/test';
import { adminContext, inviteAndActivate } from './users.ts';

test.describe('RFC-73 R1, R2 help topic anchors (plan 12a)', () => {
  test('/app/help/workflow#contest scrolls the Contest heading into view', async ({ browser }) => {
    // Any signed-in user reaches the help pages (RFC-73 R1: no permission),
    // so the seeded administrator's reused session is enough here.
    const admin = await adminContext(browser);
    try {
      const page = await admin.newPage();
      await page.goto('/app/help/workflow#contest');
      // By id, not by the visible "Contest" text: the scroll mechanism
      // (`@tanstack/router-core`'s `setupScrollRestoration`) resolves the
      // hash with `document.getElementById(hash)`, and the id is the seeded
      // section's anchor (migration `help_seed`, RFC-73 R2) that every
      // `helpHref('workflow', 'contest')` call site keys on. The heading's
      // text can be edited on the site; the anchor never changes (RFC-73 R6).
      const heading = page.locator('#contest');

      // `toBeVisible()` alone would also pass if the `#contest` hash failed
      // to scroll: the heading renders on the page regardless of where the
      // viewport sits. What this test is actually pinning down is that the
      // browser scrolled to it, so where the heading sits relative to the
      // viewport is asserted as well — the "Contest" heading sits well down
      // the workflow topic, past what a fresh, unscrolled load would show.
      await expect(heading).toBeVisible();

      // `toBeInViewport`, not one-shot `boundingBox()` arithmetic: the
      // landing is corrected once the web fonts settle (`hashAnchor.ts`),
      // and this matcher retries until it has, where a single measurement
      // races that correction. `ratio: 1` asks for the WHOLE heading, which
      // is what "into view" means and what `scroll-mt-6` leaves room for —
      // 24px of clearance above it, ~690px below, so nothing but a broken
      // anchor can fail it. The plain default would accept a one-pixel
      // sliver, and a sliver is not a heading the reader can read.
      await expect(heading).toBeInViewport({ ratio: 1 });
    } finally {
      await admin.close();
    }
  });
});

test.describe('RFC-73 R6–R8 editing the help on the site (issue #172)', () => {
  test('the admin creates, edits and deletes a topic; a manager sees no edit control', async ({
    browser,
  }) => {
    const admin = await adminContext(browser);
    const manager = await inviteAndActivate(browser, admin, { role: 'manager' });
    const title = `E2E topic ${Date.now()}`;
    const slug = title.toLowerCase().replace(/ /g, '-');
    try {
      const page = await admin.newPage();
      await page.goto('/app/help');
      await page.getByRole('button', { name: 'New topic' }).click();
      await page.getByLabel('Title').fill(title);
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page).toHaveURL(`/app/help/${slug}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

      // A section written in HTML mode: the script is dropped by the API
      // (R8), the same-origin link navigates inside the app.
      await page.getByRole('button', { name: 'Add section' }).click();
      await page.getByLabel('Section title (optional)').fill('First steps');
      await page.getByRole('button', { name: 'HTML' }).click();
      await page
        .getByLabel('Section HTML')
        .fill(
          '<p>Hello <strong>there</strong>. <a href="/app/help">Back</a></p><script>window.pwned = 1</script>',
        );
      await page.getByRole('button', { name: 'Save' }).click();
      const heading = page.locator('#first-steps');
      await expect(heading).toHaveText('First steps');
      await expect(page.getByText('Hello')).toBeVisible();
      expect(await page.locator('article script').count()).toBe(0);
      expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();

      // Editing keeps the anchor.
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByLabel('Section title (optional)').fill('Your first steps');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('#first-steps')).toHaveText('Your first steps');

      // A manager reads the page without any edit control (R7).
      await manager.page.goto(`/app/help/${slug}#first-steps`);
      await expect(manager.page.locator('#first-steps')).toHaveText('Your first steps');
      for (const name of ['Edit topic', 'Delete topic', 'Add section', 'Edit'])
        await expect(manager.page.getByRole('button', { name, exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Delete topic' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
      await expect(page).toHaveURL('/app/help');
      await expect(page.getByRole('link', { name: title })).toHaveCount(0);
    } finally {
      await manager.context.close();
      await admin.close();
    }
  });
});

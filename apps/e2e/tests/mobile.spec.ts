import { expect, test } from '@playwright/test';
import { ADMIN_STATE } from './env.ts';

test.describe('RFC-13 R12 phone-width workspace (issue #160)', () => {
  test('/app fits 390px and the menu drawer reaches Species', async ({ browser }) => {
    // The seeded administrator's saved session, at a phone viewport: the
    // other specs run at the desktop size of the project's device.
    const context = await browser.newContext({
      storageState: ADMIN_STATE,
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto('/app');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(390);

      await page.getByRole('button', { name: 'Open menu' }).click();
      const menu = page.getByRole('dialog', { name: 'Menu' });
      await menu.getByRole('link', { name: 'Species', exact: true }).click();
      await page.waitForURL(/\/app\/species$/);
      await expect(menu).toBeHidden();
      await expect(page.getByRole('heading', { level: 1, name: 'Species' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

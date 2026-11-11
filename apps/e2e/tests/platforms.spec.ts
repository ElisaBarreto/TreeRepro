import { expect, test } from '@playwright/test';
import { BASE_URL, PLANT_URL } from './env.ts';
import { adminContext, inviteAndActivate } from './users.ts';

// RFC-14 (plan 15b): one stack answers on both platform hosts. Chromium
// resolves *.localhost to loopback, so PLANT_URL reaches the same Caddy.
test.describe('RFC-14 two platform hosts', () => {
  test('the sign-in page loads on both hosts', async ({ page }) => {
    for (const origin of [BASE_URL, PLANT_URL]) {
      await page.goto(`${origin}/`);
      await expect(page.getByLabel('Email'), origin).toBeVisible();
      await expect(page.getByLabel('Password', { exact: true }), origin).toBeVisible();
    }
  });

  test('one account signs in on each host separately', async ({ browser }) => {
    // A fresh user rather than the seeded admin: the admin holds TOTP after
    // critical-flow, and its login budget (RFC-24 R3) is spent by that spec.
    const admin = await adminContext(browser);
    const user = await inviteAndActivate(browser, admin, { role: 'contributor' });
    try {
      // RFC-14 R5: the TreeRepro session does not open PlantRepro.
      await user.page.goto(`${PLANT_URL}/app`);
      await expect(user.page).toHaveURL(`${PLANT_URL}/`);

      await user.page.getByLabel('Email').fill(user.email);
      await user.page.getByLabel('Password', { exact: true }).fill(user.password);
      await user.page.getByRole('button', { name: 'Sign in' }).click();
      await expect(user.page).toHaveURL(`${PLANT_URL}/app`);

      // Both sessions stand side by side.
      await user.page.goto(`${BASE_URL}/app`);
      await expect(user.page).toHaveURL(`${BASE_URL}/app`);
    } finally {
      await user.context.close();
      await admin.close();
    }
  });
});

import { expect, test } from '@playwright/test';
import { apiCall } from './api.ts';
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

  test('one account signs in on each host separately, only where it holds a role', async ({
    browser,
  }) => {
    // A fresh user rather than the seeded admin: the admin holds TOTP after
    // critical-flow, and its login budget (RFC-24 R3) is spent by that spec.
    const admin = await adminContext(browser);
    const user = await inviteAndActivate(browser, admin, { role: 'contributor' });
    const signIn = async () => {
      await user.page.getByLabel('Email').fill(user.email);
      await user.page.getByLabel('Password', { exact: true }).fill(user.password);
      await user.page.getByRole('button', { name: 'Sign in' }).click();
    };
    try {
      // RFC-14 R5: the TreeRepro session does not open PlantRepro.
      await user.page.goto(`${PLANT_URL}/app`);
      await expect(user.page).toHaveURL(`${PLANT_URL}/`);

      // RFC-22 R13: a TreeRepro-only contributor is refused on PlantRepro.
      await signIn();
      await expect(user.page.getByRole('alert')).toContainText(
        'You have no access to PlantRepro. Your account has access to TreeRepro.',
      );
      await expect(user.page).toHaveURL(`${PLANT_URL}/`);

      // RFC-31 R16: once an admin grants a PlantRepro role, the same credentials work there.
      const roles = await apiCall<{ data: { id: string; name: string }[] }>(
        admin,
        'GET',
        '/api/admin/roles',
      );
      const contributor = roles.json?.data.find((r) => r.name === 'contributor');
      const granted = await apiCall(admin, 'PATCH', `/api/admin/users/${user.userId}`, {
        roles: [contributor?.id],
        platform: 'plantrepro',
      });
      expect(granted.status).toBe(200);
      await signIn();
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

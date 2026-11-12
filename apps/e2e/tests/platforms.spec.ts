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

  // RFC-13 R15: password managers that honour Digital Asset Links share the login.
  test('both hosts serve the same assetlinks.json as JSON', async ({ request }) => {
    const bodies = [];
    for (const origin of [BASE_URL, PLANT_URL]) {
      const res = await request.get(`${origin}/.well-known/assetlinks.json`);
      expect(res.status(), origin).toBe(200);
      expect(res.headers()['content-type'], origin).toContain('application/json');
      bodies.push(await res.json());
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toContainEqual({
      relation: ['delegate_permission/common.get_login_creds'],
      target: { namespace: 'web', site: 'https://plantrepro.elisabarreto.com.br' },
    });
  });

  // RFC-13 R14: each host wears its own brand before the bundle runs.
  test('each host shows its own name, title and favicon', async ({ page }) => {
    for (const [origin, name, icon] of [
      [BASE_URL, 'TreeRepro', '/favicon.svg'],
      [PLANT_URL, 'PlantRepro', '/favicon-plantrepro.svg'],
    ] as const) {
      await page.goto(`${origin}/`);
      await expect(page, origin).toHaveTitle(name);
      await expect(page.locator('html'), origin).toHaveAttribute(
        'data-platform',
        name.toLowerCase(),
      );
      await expect(page.locator('link[rel="icon"]'), origin).toHaveAttribute('href', icon);
      await expect(page.getByRole('heading', { name, exact: true }), origin).toBeVisible();
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

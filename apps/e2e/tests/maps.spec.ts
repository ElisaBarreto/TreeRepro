import { expect, test } from '@playwright/test';
import { adminContext } from './users.ts';

test.describe('RFC-76 R6 trait maps (issue #197)', () => {
  test('an admin opens Maps from the sidebar and finds the empty production manifest', async ({
    browser,
  }) => {
    // dataset.read is held by every seeded role, so the administrator's
    // reused session is enough here — no second role to set up.
    const admin = await adminContext(browser);
    try {
      const page = await admin.newPage();
      await page.goto('/app');
      await page.getByRole('link', { name: 'Maps' }).click();
      await expect(page).toHaveURL('/app/maps');
      // MapsPage.tsx: `dictionary.isSuccess && maps.isSuccess && categories
      // .length === 0` renders `<EmptyState title="No maps yet." />`; the
      // production manifest (`apps/api/maps/manifest.csv`) ships with no
      // rows, so every category is empty of maps.
      await expect(page.getByText('No maps yet.')).toBeVisible();
    } finally {
      await admin.close();
    }
  });
});

import { expect, test } from '@playwright/test';
import { adminContext } from './users.ts';

test.describe('RFC-76 R7 trait maps (issues #197, #293)', () => {
  test('an admin opens Maps from the sidebar and finds no maps before the first snapshot', async ({
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
      // MapsPage.tsx: `succeeded && !category` renders `<EmptyState
      // title="No maps yet." />`. The e2e stack never runs a region snapshot
      // (RFC-78 R12: the timer's first tick waits a minute and the stack has
      // no WCVP load), so `GET /api/maps` answers an empty list.
      await expect(page.getByText('No maps yet.')).toBeVisible();
    } finally {
      await admin.close();
    }
  });
});

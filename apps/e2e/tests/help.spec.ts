import { expect, test } from '@playwright/test';
import { adminContext } from './users.ts';

test.describe('RFC-73 R1, R2 help topic anchors (plan 12a)', () => {
  test('/app/help/workflow#contest scrolls the Contest heading into view', async ({ browser }) => {
    // Any signed-in user reaches the help pages (RFC-73 R1: no permission),
    // so the seeded administrator's reused session is enough here.
    const admin = await adminContext(browser);
    try {
      const page = await admin.newPage();
      await page.goto('/app/help/workflow#contest');
      const heading = page.getByRole('heading', { name: 'Contest', exact: true });

      // `toBeVisible()` alone would also pass if the `#contest` hash failed
      // to scroll: the heading renders on the page regardless of where the
      // viewport sits. What this test is actually pinning down is that the
      // browser scrolled to it, so the heading's bounding box is checked
      // against the viewport as well — the "Contest" heading sits well down
      // `workflow.tsx`'s body, past what a fresh, unscrolled load would show.
      await expect(heading).toBeVisible();
      const box = await heading.boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) {
        throw new Error('the Contest heading or the page viewport had no box to compare');
      }
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeLessThan(viewport.height);
    } finally {
      await admin.close();
    }
  });
});

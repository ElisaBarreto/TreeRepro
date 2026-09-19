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
      // By id, not by the visible "Contest" text: the scroll mechanism
      // (`@tanstack/router-core`'s `setupScrollRestoration`) resolves the
      // hash with `document.getElementById(hash)`, and the id is what
      // `workflow.tsx`'s `anchors` array, `HELP_ANCHORS`, `anchors.test.ts`
      // and every `helpHref('workflow', 'contest')` call site key on too.
      // RFC-73 R5's owner copy review is still open, so the heading's text
      // may still change; the id is the stable, load-bearing part.
      const heading = page.locator('#contest');

      // `toBeVisible()` alone would also pass if the `#contest` hash failed
      // to scroll: the heading renders on the page regardless of where the
      // viewport sits. What this test is actually pinning down is that the
      // browser scrolled to it, so where the heading sits relative to the
      // viewport is asserted as well — the "Contest" heading sits well down
      // `workflow.tsx`'s body, past what a fresh, unscrolled load would show.
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

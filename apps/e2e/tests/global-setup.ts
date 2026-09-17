import { type Browser, chromium, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_STATE, adminInviteLink, adminPassword } from './env.ts';

/**
 * Signs in as the administrator through the login form, in a context that
 * touches nothing else and is closed right after, and saves the resulting
 * cookie to `ADMIN_STATE`. A failed sign-in throws rather than silently
 * saving a signed-out state: a loud failure here beats a cascade of
 * unexplained `adminContext()` failures in every later spec file.
 *
 * A *fresh* context matters, not just a fresh login: `critical-flow.spec.ts`
 * reuses one `page` across its whole file and signs it out more than once
 * (its own tests need to), so saving straight from that page's context
 * would later go stale the moment it next signs out — the cookie string
 * would still be on disk, but the session record behind it would already be
 * gone. A context nothing else ever touches again does not have that
 * problem.
 */
export async function signInAndSaveState(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Relative '/': only ever called with the test runner's browser fixture,
  // which carries the config's baseURL (unlike globalSetup below's bare
  // chromium.launch(), which is why that one does not use this helper).
  await page.goto('/');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible();
  await context.storageState({ path: ADMIN_STATE });
  await context.close();
}

/**
 * Runs once before the suite (`playwright.config.ts`'s `globalSetup`):
 * accepts the seeded administrator's one-shot invitation (RFC-20 R6), which
 * also signs the admin in (a session exists the moment this succeeds), and
 * saves that cookie to `ADMIN_STATE` directly — not through
 * `signInAndSaveState`. Two reasons: nothing in this function's own context
 * signs that session out again, so a fresh one is not needed for
 * correctness; and the `login` route is rate-limited to 5 attempts per 15
 * minutes per email+IP (RFC-24 R3), a budget `critical-flow.spec.ts` alone
 * spends exactly by using its own sign-ins and one `signInAndSaveState()`
 * call — an extra attempt here, with no behavioural payoff (the
 * invitation-acceptance endpoint already proves the credentials and creates
 * a real session), risks tipping a later, necessary sign-in into 429
 * `RATE_LIMITED`.
 */
export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(adminInviteLink());
  await page.getByLabel('New password').fill(adminPassword());
  await page.getByLabel('Confirm password').fill(adminPassword());
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await context.storageState({ path: ADMIN_STATE });
  await browser.close();
}

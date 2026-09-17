import { chromium } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_STATE, adminInviteLink } from './env.ts';

/**
 * Runs once before the suite (`playwright.config.ts`'s `globalSetup`):
 * accepts the seeded administrator's one-shot invitation (RFC-20 R6), which
 * also signs the admin in, and saves the resulting cookie to `ADMIN_STATE`.
 * Every later spec file gets an already-authenticated admin context through
 * `adminContext()` (`users.ts`) instead of spending the link a second time.
 */
export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(adminInviteLink());
  await page.getByLabel('New password').fill(ADMIN_PASSWORD);
  await page.getByLabel('Confirm password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await page.waitForURL(/\/app$/);
  await context.storageState({ path: ADMIN_STATE });
  await browser.close();
}

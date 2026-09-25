import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { apiCall } from './api.ts';
import { ADMIN_STATE, password } from './env.ts';
import { waitForLink } from './mailpit.ts';

interface CreatedUser {
  id: string;
}
interface Role {
  id: string;
  name: string;
}

/** A context signed in as the seeded administrator, reusing the cookie `global-setup.ts` saved. */
export async function adminContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: ADMIN_STATE });
}

/**
 * Invites a fresh user holding `role` (looked up by name through
 * `GET /api/admin/roles`) and accepts the invitation in a new context.
 * RFC-50 R3.
 */
export async function inviteAndActivate(
  browser: Browser,
  admin: BrowserContext,
  input: { role: 'contributor' | 'manager'; name?: string },
): Promise<{
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  userId: string;
}> {
  const roles = await apiCall<{ data: Role[] }>(admin, 'GET', '/api/admin/roles');
  if (roles.status !== 200 || !roles.json) {
    throw new Error(`GET /api/admin/roles answered ${roles.status}`);
  }
  const role = roles.json.data.find((candidate) => candidate.name === input.role);
  if (!role) throw new Error(`no role named ${input.role} (GET /api/admin/roles)`);

  const email = `e2e-${randomBytes(6).toString('hex')}@e2e.test`;
  const name = input.name ?? 'E2E User';
  const invited = await apiCall<{ data: CreatedUser }>(admin, 'POST', '/api/admin/users', {
    email,
    name,
    roles: [role.id],
  });
  if (invited.status !== 201 || !invited.json) {
    throw new Error(`POST /api/admin/users answered ${invited.status} for ${email}`);
  }
  const userId = invited.json.data.id;

  // The role is held from the invitation on, so the session the accept step
  // opens already carries it.
  const context = await browser.newContext();
  const page = await context.newPage();
  const link = await waitForLink(page.request, email, 'invite');
  const userPassword = password();
  await page.goto(link);
  await page.getByLabel('New password').fill(userPassword);
  await page.getByLabel('Confirm password').fill(userPassword);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await page.waitForURL(/\/app$/);

  return { context, page, email, password: userPassword, userId };
}

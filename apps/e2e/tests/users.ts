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
 * Invites a fresh user, accepts the invitation in a new context, grants
 * `role` (looked up by name through `GET /api/admin/roles`, since the roles
 * this invites into are created per plan rather than seeded) and signs in
 * again so the returned context reflects it. RFC-50 R3, R5.
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
  const email = `e2e-${randomBytes(6).toString('hex')}@e2e.test`;
  const name = input.name ?? 'E2E User';
  const invited = await apiCall<{ data: CreatedUser }>(admin, 'POST', '/api/admin/users', {
    email,
    name,
  });
  if (invited.status !== 201 || !invited.json) {
    throw new Error(`POST /api/admin/users answered ${invited.status} for ${email}`);
  }
  const userId = invited.json.data.id;

  const context = await browser.newContext();
  const page = await context.newPage();
  const link = await waitForLink(page.request, email, 'invite');
  const userPassword = password();
  await page.goto(link);
  await page.getByLabel('New password').fill(userPassword);
  await page.getByLabel('Confirm password').fill(userPassword);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();
  await page.waitForURL(/\/app$/);

  const roles = await apiCall<{ data: Role[] }>(admin, 'GET', '/api/admin/roles');
  if (roles.status !== 200 || !roles.json) {
    throw new Error(`GET /api/admin/roles answered ${roles.status}`);
  }
  const role = roles.json.data.find((candidate) => candidate.name === input.role);
  if (!role) throw new Error(`no role named ${input.role} (GET /api/admin/roles)`);
  const patched = await apiCall(admin, 'PATCH', `/api/admin/users/${userId}`, {
    roles: [role.id],
  });
  if (patched.status !== 200) {
    throw new Error(`PATCH /api/admin/users/${userId} answered ${patched.status}`);
  }

  // A fresh sign-in (rather than trusting the session the accept step left
  // behind) so the SPA refetches `/api/auth/me` and renders role-gated UI
  // for the role just granted, not the one held when the page last loaded.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(userPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app$/);

  return { context, page, email, password: userPassword, userId };
}

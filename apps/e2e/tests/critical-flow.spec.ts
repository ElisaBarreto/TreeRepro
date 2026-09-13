import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { type CspWatch, watchCsp } from './csp.ts';
import { ADMIN_EMAIL, adminInviteLink, password } from './env.ts';
import { waitForLink } from './mailpit.ts';
import { codeFor } from './totp.ts';

// One story, in order, on one browser page (plus a second context for user B):
// every step depends on the previous one, so the file runs serially and stops
// at the first failure (the later steps would only fail for the same reason).
test.describe.configure({ mode: 'serial' });

const B_EMAIL = 'bea@e2e.test';
const B_NAME = 'Bea';
const ROLE_NAME = 'Readers';

let context: BrowserContext;
let csp: CspWatch;
let page: Page;
let adminPassword = password();
let totpSecret = '';

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  csp = await watchCsp(context);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test.afterEach(() => {
  expect(csp.violations, 'CSP violations on the pages visited so far').toEqual([]);
});

async function signIn(who: Page, email: string, pass: string, code?: string) {
  await who.goto('/');
  await who.getByLabel('Email').fill(email);
  await who.getByLabel('Password', { exact: true }).fill(pass);
  await who.getByRole('button', { name: 'Sign in' }).click();
  if (code) {
    await who.getByLabel('Verification code').fill(code);
    await who.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(who).toHaveURL(/\/app$/);
  await expect(who.getByRole('heading', { name: 'Workspace' })).toBeVisible();
}

async function signOut(who: Page) {
  // exact: true — the Settings page's Sessions section also has a
  // "Sign out everywhere" button and per-row "Sign out <user agent>"
  // buttons, both of which contain "Sign out" as a substring.
  await who.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(who).toHaveURL(/\/$/);
  await expect(who.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}

async function acceptInvitation(who: Page, link: string, pass: string) {
  await who.goto(link);
  await expect(who.getByRole('heading', { name: 'Welcome to TreeRepro' })).toBeVisible();
  await who.getByLabel('New password').fill(pass);
  await who.getByLabel('Confirm password').fill(pass);
  await who.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(who).toHaveURL(/\/app$/);
}

test.describe('RFC-01 R6, RFC-13 R8 critical flow (issue #20)', () => {
  test('RFC-20 R6 the seeded administrator accepts the printed invitation and lands in the workspace', async () => {
    await acceptInvitation(page, adminInviteLink(), adminPassword);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
    await signOut(page);
  });

  test('RFC-21 R5-R6 password reset through Mailpit', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(
      page.getByText('If that email has an account, a reset link is on its way.'),
    ).toBeVisible();

    const link = await waitForLink(page.request, ADMIN_EMAIL, 'reset-password');
    const next = password();
    await page.goto(link);
    await page.getByLabel('New password').fill(next);
    await page.getByLabel('Confirm password').fill(next);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('heading', { name: 'Your password is changed.' })).toBeVisible();
    adminPassword = next;
    await signIn(page, ADMIN_EMAIL, adminPassword);
  });

  test('RFC-23 R2-R3 enables two-factor from the shown secret and signs in again with the next code', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    const totp = page.getByRole('region', { name: 'Two-factor authentication' });
    await totp.getByRole('button', { name: 'Set up' }).click();
    const secret = await totp.getByText(/^[A-Z2-7]{16,}$/).textContent();
    if (!secret) throw new Error('no TOTP secret shown');
    totpSecret = secret;
    await totp.getByLabel('Verification code').fill(codeFor(totpSecret));
    await totp.getByRole('button', { name: 'Turn on' }).click();
    await expect(
      totp.getByText('Save these recovery codes somewhere safe.', { exact: false }),
    ).toBeVisible();
    await expect(totp.getByRole('listitem')).toHaveCount(10);
    await totp.getByRole('button', { name: 'I saved these codes' }).click();
    await expect(totp.getByText('Two-factor authentication is on.')).toBeVisible();

    await signOut(page);
    await signIn(page, ADMIN_EMAIL, adminPassword, codeFor(totpSecret, 1));
  });

  test('RFC-31 R3, RFC-50 R3, R5 creates the Readers role, invites B and gives B the role', async () => {
    await page.getByRole('link', { name: 'Roles' }).click();
    await page.getByRole('button', { name: 'New role' }).click();
    const dialog = page.getByRole('dialog', { name: 'New role' });
    await dialog.getByLabel('Name').fill(ROLE_NAME);
    await dialog.getByLabel('Description').fill('May list users');
    await dialog.getByRole('checkbox', { name: /List and view users/ }).check();
    await dialog.getByRole('button', { name: 'Create role' }).click();
    await expect(dialog).toBeHidden();
    // exact: true — the row's Actions cell has no name of its own, so its
    // accessible name is built from the Edit/Delete buttons' aria-labels
    // ("Edit Readers Delete Readers"), which also contains the role name.
    await expect(page.getByRole('cell', { name: ROLE_NAME, exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Users' }).click();
    await page.getByRole('button', { name: 'Invite user' }).click();
    const invite = page.getByRole('dialog', { name: 'Invite user' });
    await invite.getByLabel('Email').fill(B_EMAIL);
    await invite.getByLabel('Name').fill(B_NAME);
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toHaveText(`Invitation sent to ${B_EMAIL}.`);

    await page.getByRole('link', { name: B_NAME }).click();
    await expect(page.getByRole('heading', { name: B_NAME })).toBeVisible();
    const roles = page.getByRole('region', { name: 'Roles' });
    await roles.getByRole('checkbox', { name: /^Readers\b/ }).check();
    await roles.getByRole('button', { name: 'Save roles' }).click();
    await expect(roles.getByRole('status')).toHaveText('Roles saved.');
  });

  test('RFC-13 R3, RFC-32 R4 B accepts, sees no Admin entry, and the API refuses the roles list', async ({
    browser,
  }) => {
    const contextB = await browser.newContext();
    const cspB = await watchCsp(contextB);
    const pageB = await contextB.newPage();
    const link = await waitForLink(pageB.request, B_EMAIL, 'invite');
    await acceptInvitation(pageB, link, password());
    await expect(pageB.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(pageB.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
    await expect(pageB.getByRole('link', { name: 'Users' })).toHaveCount(0);

    const refused = await contextB.request.get('/api/admin/roles');
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'PERMISSION_DENIED',
    );

    // The administrator suspends B; B's next navigation lands on the sign-in page (RFC-50 R6, RFC-13 R2).
    await page.getByRole('link', { name: 'Users' }).click();
    await page.getByRole('link', { name: B_NAME }).click();
    await page.getByRole('button', { name: 'Suspend' }).click();
    await page
      .getByRole('dialog', { name: `Suspend ${B_NAME}?` })
      .getByRole('button', { name: 'Suspend' })
      .click();
    await expect(page.getByText('suspended', { exact: true })).toBeVisible();

    await pageB.goto('/app/settings');
    await expect(pageB).toHaveURL(/\/$/);
    await expect(pageB.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(cspB.violations).toEqual([]);
    await contextB.close();
  });
});

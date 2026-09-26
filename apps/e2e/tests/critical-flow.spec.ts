import { type BrowserContext, expect, type Page, request, test } from '@playwright/test';
import { type CspWatch, watchCsp } from './csp.ts';
import { ADMIN_EMAIL, adminPassword, BASE_URL, password } from './env.ts';
import { signInAndSaveState } from './global-setup.ts';
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
let currentPassword = adminPassword();
let totpSecret = '';
let apiSecret = '';

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  csp = await watchCsp(context);
  page = await context.newPage();
});

test.afterAll(async () => {
  // ADMIN_STATE is re-established inside the password-reset test below, not
  // here: by the time this file's last test finishes, TOTP is enabled on
  // the admin account (the third test turns it on), and a plain sign-in
  // this late cannot succeed, while a TOTP-coded one cannot pick a step
  // that is both unclaimed (RFC-23 R4's replay guard) and still inside the
  // ±1-step verification window without an actual wait of up to ~60s for
  // the next window to arrive. The reset test is the last point a plain
  // ADMIN_EMAIL/ADMIN_PASSWORD sign-in still works, and — via
  // signInAndSaveState()'s own, separate context — nothing after it ever
  // signs that particular session out, so the state it saves stays valid
  // through the rest of this file and every later spec file's
  // adminContext().
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
  await expect(
    who.getByRole('heading', {
      level: 1,
      name: 'Help complete what we know about how trees reproduce.',
    }),
  ).toBeVisible();
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

/** RFC-21 R5-R6: request a reset link by email and set `next` through it. Leaves `who` signed out (R6: reset creates no session). */
async function resetPasswordByEmail(who: Page, email: string, next: string) {
  await who.goto('/');
  await who.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(who).toHaveURL(/\/forgot-password$/);
  await who.getByLabel('Email').fill(email);
  await who.getByRole('button', { name: 'Send reset link' }).click();
  await expect(
    who.getByText('If that email has an account, a reset link is on its way.'),
  ).toBeVisible();

  const link = await waitForLink(who.request, email, 'reset-password');
  await who.goto(link);
  await who.getByLabel('New password').fill(next);
  await who.getByLabel('Confirm password').fill(next);
  await who.getByRole('button', { name: 'Change password' }).click();
  await expect(who.getByRole('heading', { name: 'Your password is changed.' })).toBeVisible();
}

test.describe('RFC-01 R6, RFC-13 R8 critical flow (issue #20)', () => {
  test('RFC-22 R2-R3 the seeded administrator signs in and lands in the workspace', async () => {
    await signIn(page, ADMIN_EMAIL, currentPassword);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
    await signOut(page);
  });

  test('RFC-21 R5-R6 password reset through Mailpit', async ({ browser }) => {
    const next = password();
    await resetPasswordByEmail(page, ADMIN_EMAIL, next);
    currentPassword = next;
    await signIn(page, ADMIN_EMAIL, currentPassword);

    // Restore ADMIN_PASSWORD: adminContext() and every later spec file sign
    // in with the env password.
    await signOut(page);
    await resetPasswordByEmail(page, ADMIN_EMAIL, adminPassword());
    currentPassword = adminPassword();
    await signIn(page, ADMIN_EMAIL, currentPassword);

    // The resets above each revoked every session of the admin user
    // (RFC-21 R6), including the one global-setup.ts saved to ADMIN_STATE.
    // Re-establish it now, through a *separate* context: `page`'s own
    // session (just proven above) is not enough on its own, because the
    // next test signs `page` out again — saving straight from `page`'s
    // context here would leave ADMIN_STATE holding a cookie whose session
    // record gets deleted minutes (or seconds) later, failing the same way
    // as not refreshing it at all. signInAndSaveState() throws if the
    // sign-in itself fails, which fails this test loudly instead of
    // silently leaving ADMIN_STATE dead for every later spec file's
    // adminContext(). This is also the *only* place in the file that calls
    // it (not afterAll, not global-setup.ts) — the `login` route allows
    // just 5 attempts per 15 minutes per email+IP (RFC-24 R3), and this
    // file's sign-ins plus this one call already use exactly that budget.
    await signInAndSaveState(browser);
  });

  test('RFC-23 R2-R3 enables two-factor from the shown secret and signs in again with the next code', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    const totp = page.getByRole('region', { name: 'Two-factor authentication' });
    await totp.getByRole('button', { name: 'Set up' }).click();
    const start = page.getByRole('dialog', { name: 'Set up two-factor authentication' });
    await start.getByLabel('Password').fill(currentPassword);
    await start.getByRole('button', { name: 'Continue' }).click();
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
    // The enrolment claimed the step current at that moment and the API's
    // guard is monotonic (`counter <= last` rejects), so the next step is
    // always accepted and never collides; the +1 tolerates a container clock
    // up to two steps ahead of the host, not behind across a boundary
    // (irrelevant in CI, where the clock is shared).
    await signIn(page, ADMIN_EMAIL, currentPassword, codeFor(totpSecret, 1));
  });

  test('RFC-82 R1-R3 creates an API key in Settings and reads the pending queue with it', async () => {
    await page.goto(`${BASE_URL}/app/settings`);
    // `Section` (apps/web/src/components/ui/Section.tsx) puts its `id` prop
    // on the heading (`<id>-heading`), not on the `<section>` itself — same
    // as every other Settings section, reached the same way below.
    const section = page.getByRole('region', { name: 'API keys' });
    await section.getByLabel('Key name').fill('e2e');
    await section.getByLabel('Current password').fill(currentPassword);
    // The previous test claimed step 0 (enrolment) and step 1 (the sign-in
    // right after) — both relative to *its own* clock reading, a couple of
    // seconds ago. No offset from *this* clock reading can both clear RFC-23
    // R4's replay guard (a counter strictly greater than the one that test
    // claimed) and land inside RFC-23 R1's ±1-step verification window: any
    // offset high enough to be unclaimed is also too far ahead of "now" to
    // verify, since the two tests run less than one 30 s step apart. Waiting
    // past the boundary *after* next guarantees "now" itself lands at least
    // two steps beyond whatever step was current when that test claimed
    // its own, so offset 0 (the default, as the enrolment step used) is then
    // both fresh and in-window.
    const stepMs = 30_000;
    await page.waitForTimeout(stepMs - (Date.now() % stepMs) + stepMs);
    await section.getByLabel('Verification code').fill(codeFor(totpSecret));
    await section.getByRole('button', { name: 'Create key' }).click();
    const secret = (await section.locator('code').textContent())?.trim();
    expect(secret).toMatch(/^tr_live_/);
    apiSecret = secret ?? '';

    // A context with no storage state: `page.request` would ride along with
    // the admin's session cookie, and R4 refuses a request carrying both.
    const anonymous = await request.newContext();
    const res = await anonymous.get(`${BASE_URL}/api/records/pending/traits`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status()).toBe(200);

    // R4: the same key plus the session cookie is refused outright, not
    // merely ignored in favour of the cookie.
    const withCookie = await page.request.get(`${BASE_URL}/api/records/pending/traits`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(withCookie.status()).toBe(401);

    // R6: a key never reaches a self-service route, even alone.
    const selfService = await anonymous.get(`${BASE_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(selfService.status()).toBe(401);
    await anonymous.dispose();
  });

  test('RFC-82 R10-R15 sends a batch with the key and sees its effect in the workspace', async () => {
    const family = `E2ebatchaceae${Date.now()}`;
    const anonymous = await request.newContext();
    const res = await anonymous.post(`${BASE_URL}/api/batch`, {
      headers: { authorization: `Bearer ${apiSecret}` },
      data: {
        ops: [
          { ref: 'new', method: 'POST', path: '/api/families', body: { name: family } },
          { ref: 'dup', method: 'POST', path: '/api/families', body: { name: family } },
          { ref: 'nested', method: 'POST', path: '/api/batch', body: { ops: [] } },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.summary).toEqual({ ok: 1, failed: 2 });
    expect(data.results.map((r: { status: number }) => r.status)).toEqual([201, 409, 400]);
    await anonymous.dispose();

    await page.goto(`${BASE_URL}/app/taxa`);
    // Not getByText: an alphabetically-early family name is auto-selected by
    // TaxaEditor and then renders twice (the sidebar list button and the
    // <h2> heading), which a plain text locator matches ambiguously. The
    // sidebar button is unique whether or not the family ends up selected.
    await expect(page.getByRole('button', { name: family })).toBeVisible();
  });

  test('RFC-31 R3, RFC-50 R3 creates the Readers role and invites B holding it', async () => {
    await page.getByRole('link', { name: 'Roles' }).click();
    await page.getByRole('button', { name: 'New role' }).click();
    const dialog = page.getByRole('dialog', { name: 'New role' });
    // The permission catalog loads asynchronously; wait for a group to render
    // (fieldset legends name them) before touching the form, so the fill
    // below is deterministic rather than racing the fetch — a warm local run
    // usually wins that race, CI does not. exact: true on every getByLabel in
    // this dialog: getByLabel does a case-insensitive substring match, and
    // once the catalog is in, one permission's label reads "…genera, species
    // and names", which contains "Name" as a substring.
    await dialog.getByRole('group', { name: 'users' }).waitFor();
    await dialog.getByLabel('Name', { exact: true }).fill(ROLE_NAME);
    await dialog.getByLabel('Description', { exact: true }).fill('May list users');
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
    // exact: true for the same reason as the New role dialog above.
    await invite.getByLabel('Email', { exact: true }).fill(B_EMAIL);
    await invite.getByLabel('Name', { exact: true }).fill(B_NAME);
    await invite.getByLabel('Role', { exact: true }).selectOption({ label: ROLE_NAME });
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toHaveText(`Invitation sent to ${B_EMAIL}.`);
    // RFC-50 R3: the invited user is listed already holding the chosen role.
    await expect(page.getByRole('row').filter({ hasText: B_EMAIL })).toContainText(ROLE_NAME);

    await page.getByRole('link', { name: B_NAME }).click();
    await expect(page.getByRole('heading', { name: B_NAME })).toBeVisible();
    const roles = page.getByRole('region', { name: 'Roles' });
    await expect(roles.getByRole('checkbox', { name: /^Readers\b/ })).toBeChecked();
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

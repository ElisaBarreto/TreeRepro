import { expect, test } from '@playwright/test';
import { watchCsp } from './csp.ts';

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>/i;
const STYLE_TAG = /<style[\s>]/i;
const STYLE_ATTRIBUTE = /\sstyle\s*=/i;

test.describe('RFC-02 R5, RFC-13 R5 Content-Security-Policy (issue #9)', () => {
  test('the served document carries the strict policy and no inline script or style', async ({
    request,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const csp = response.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    const html = await response.text();
    expect(html).toMatch(/<script[^>]*\bsrc="\/assets\//);
    expect(html).not.toMatch(INLINE_SCRIPT);
    expect(html).not.toMatch(STYLE_TAG);
    expect(html).not.toMatch(STYLE_ATTRIBUTE);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
  });

  test('RFC-10 R10 /api/health/ready is not reachable through Caddy; /api/health is', async ({
    request,
  }) => {
    expect((await request.get('/api/health/ready')).status()).toBe(404);
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
  });

  test('the public pages render without a CSP violation', async ({ browser }) => {
    const context = await browser.newContext();
    const csp = await watchCsp(context);
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await page.goto('/reset-password/not-a-real-token');
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    expect(csp.violations).toEqual([]);
    await context.close();
  });
});

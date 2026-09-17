import { defineConfig, devices } from '@playwright/test';

// The stack is started by scripts/e2e.sh, which sets E2E_BASE_URL; the
// default matches compose.e2e.yml for a run against a stack left up with E2E_KEEP.
export default defineConfig({
  testDir: './tests',
  // Accepts the seeded administrator's invitation once and saves the
  // resulting cookie (tests/global-setup.ts); adminContext() reuses it.
  globalSetup: './tests/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // A retry would replay "accept invitation" against a consumed token on the
  // same database; the flow is one-shot per stack.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

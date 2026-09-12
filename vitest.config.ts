import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*',
      'tools/*',
      'apps/web',
      {
        test: {
          name: 'api:unit',
          root: 'apps/api',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'api:integration',
          root: 'apps/api',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});

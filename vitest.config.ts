import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*',
      'tools/*',
      {
        test: {
          name: 'api:unit',
          root: 'apps/api',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
        },
      },
    ],
  },
});

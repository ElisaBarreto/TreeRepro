import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'rfc-lint', include: ['src/**/*.test.ts'] },
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './error-codes.ts';

describe('RFC-12 R3 error code catalog', () => {
  it('matches the table in docs/rfc/10-platform/12-error-codes.md exactly', () => {
    const doc = readFileSync(
      new URL('../../../docs/rfc/10-platform/12-error-codes.md', import.meta.url),
      'utf8',
    );
    const rows = [...doc.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*(\d{3})\s*\|/gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.fromEntries(rows)).toEqual(ERROR_CODES);
  });

  it('RFC-12 R1 codes are SCREAMING_SNAKE_CASE', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(code).toMatch(/^[A-Z][A-Z_]+$/);
  });
});

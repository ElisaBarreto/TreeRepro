import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from './actions.ts';

describe('RFC-41 R3 action catalog', () => {
  it('matches the Actions table in docs/rfc/40-data-protection/41-audit-log.md exactly', () => {
    const doc = readFileSync(
      new URL('../../../../docs/rfc/40-data-protection/41-audit-log.md', import.meta.url),
      'utf8',
    );
    const documented = [...doc.matchAll(/^\|\s*`([a-z_]+(?:\.[a-z_]+)+)`\s*\|/gm)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(0);
    expect([...AUDIT_ACTIONS]).toEqual(documented);
  });
});

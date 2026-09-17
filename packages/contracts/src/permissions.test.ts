import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPermissionKey, PERMISSION_KEYS, PERMISSIONS } from './permissions.ts';

describe('RFC-30 R2 permission catalog', () => {
  it('matches the Catalog table in docs/rfc/30-access/30-permission-catalog.md exactly', () => {
    const doc = readFileSync(
      new URL('../../../docs/rfc/30-access/30-permission-catalog.md', import.meta.url),
      'utf8',
    );
    const rows = [...doc.matchAll(/^\|\s*`([a-z]+\.[a-z_]+)`\s*\|\s*([^|]+?)\s*\|$/gm)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.fromEntries(rows)).toEqual(PERMISSIONS);
  });

  it('R1 keys are <resource>.<action> and PERMISSION_KEYS lists them in catalog order', () => {
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(PERMISSION_KEYS).toEqual(Object.keys(PERMISSIONS));
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('isPermissionKey narrows strings', () => {
    expect(isPermissionKey('users.read')).toBe(true);
    expect(isPermissionKey('users.fly')).toBe(false);
    expect(isPermissionKey('')).toBe(false);
  });
});

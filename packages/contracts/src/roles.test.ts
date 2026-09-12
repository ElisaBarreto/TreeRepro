import { describe, expect, it } from 'vitest';
import { permissionEntrySchema, roleNameSchema, roleSchema } from './roles.ts';

describe('RFC-31 R3 role name', () => {
  it('trims and bounds 1–64 characters', () => {
    expect(roleNameSchema.parse('  Editors ')).toBe('Editors');
    expect(roleNameSchema.safeParse('   ').success).toBe(false);
    expect(roleNameSchema.safeParse('x'.repeat(65)).success).toBe(false);
  });
});

describe('RFC-31 R1 role and RFC-30 R5 permission entry shapes', () => {
  it('validate the response objects', () => {
    expect(
      roleSchema.safeParse({
        id: '019b4a2e-5f3c-7c8e-8d1a-2f3b4c5d6e7f',
        name: 'Editors',
        description: '',
        isSystem: false,
        permissions: ['users.read'],
        createdAt: '2026-09-12T10:00:00.000Z',
        updatedAt: '2026-09-12T10:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(roleSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(
      permissionEntrySchema.safeParse({ key: 'users.read', description: 'List and view users' })
        .success,
    ).toBe(true);
    expect(permissionEntrySchema.safeParse({ key: 'nope', description: 'x' }).success).toBe(false);
  });
});

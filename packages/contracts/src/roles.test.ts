import { describe, expect, it } from 'vitest';
import {
  createRoleBodySchema,
  permissionEntrySchema,
  roleIdParamSchema,
  roleNameSchema,
  roleSchema,
  updateRoleBodySchema,
} from './roles.ts';

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

describe('RFC-50 R10 role request schemas', () => {
  it('create needs name and permissions; description defaults to empty', () => {
    expect(createRoleBodySchema.parse({ name: 'Editors', permissions: ['users.read'] })).toEqual({
      name: 'Editors',
      description: '',
      permissions: ['users.read'],
    });
    expect(createRoleBodySchema.safeParse({ name: 'Editors' }).success).toBe(false);
    // Unknown keys pass the schema: the service answers PERMISSION_UNKNOWN (RFC-31 R3).
    expect(
      createRoleBodySchema.safeParse({ name: 'Editors', permissions: ['users.fly'] }).success,
    ).toBe(true);
    expect(createRoleBodySchema.safeParse({ name: '', permissions: [] }).success).toBe(false);
  });

  it('update needs at least one field', () => {
    expect(updateRoleBodySchema.safeParse({}).success).toBe(false);
    expect(updateRoleBodySchema.safeParse({ description: 'x' }).success).toBe(true);
    expect(updateRoleBodySchema.safeParse({ isSystem: true }).success).toBe(false);
  });

  it('id param is a uuid', () => {
    expect(
      roleIdParamSchema.safeParse({ id: '019a0000-0000-7000-8000-000000000001' }).success,
    ).toBe(true);
    expect(roleIdParamSchema.safeParse({ id: 'admin' }).success).toBe(false);
  });
});

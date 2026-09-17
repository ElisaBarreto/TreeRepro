import { describe, expect, it } from 'vitest';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  nameSchema,
  updateMeBodySchema,
  updateUserBodySchema,
  userIdParamSchema,
  userSchema,
} from './users.ts';

const user = {
  id: '019a0000-0000-7000-8000-000000000001',
  email: 'ada@example.test',
  name: 'Ada',
  status: 'active',
  totpEnabled: false,
  roles: [{ id: '019a0000-0000-7000-8000-000000000002', name: 'admin' }],
  plots: [],
  restrictToAssignedPlots: false,
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
  suspendedAt: null,
};

describe('RFC-50 R1 user representation', () => {
  it('accepts the documented shape and rejects extra or secret fields', () => {
    expect(userSchema.safeParse(user).success).toBe(true);
    expect(userSchema.safeParse({ ...user, passwordHash: 'x' }).success).toBe(false);
    expect(userSchema.safeParse({ ...user, status: 'deleted' }).success).toBe(false);
    expect(userSchema.safeParse({ ...user, suspendedAt: undefined }).success).toBe(false);
  });

  it('name is trimmed and 1–120 characters', () => {
    expect(nameSchema.parse('  Ada ')).toBe('Ada');
    expect(nameSchema.safeParse('   ').success).toBe(false);
    expect(nameSchema.safeParse('a'.repeat(121)).success).toBe(false);
  });
});

describe('RFC-50 R2–R5, R11 request schemas', () => {
  it('list query accepts status and pagination only', () => {
    expect(listUsersQuerySchema.parse({ status: 'invited', limit: '10' })).toEqual({
      status: 'invited',
      limit: 10,
    });
    expect(listUsersQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ q: 'ada' }).success).toBe(false);
  });

  it('id params are uuids', () => {
    expect(userIdParamSchema.safeParse({ id: user.id }).success).toBe(true);
    expect(userIdParamSchema.safeParse({ id: '0'.repeat(64) }).success).toBe(false);
  });

  it('create needs email and name', () => {
    expect(createUserBodySchema.safeParse({ email: 'ada@example.test', name: 'Ada' }).success).toBe(
      true,
    );
    expect(createUserBodySchema.safeParse({ email: 'not-an-email', name: 'Ada' }).success).toBe(
      false,
    );
    expect(createUserBodySchema.safeParse({ email: 'ada@example.test' }).success).toBe(false);
    expect(
      createUserBodySchema.safeParse({ email: 'ada@example.test', name: 'Ada', roles: [] }).success,
    ).toBe(false);
  });

  it('update needs at least one of name and roles; roles are uuids', () => {
    expect(updateUserBodySchema.safeParse({}).success).toBe(false);
    expect(updateUserBodySchema.safeParse({ name: 'Ada' }).success).toBe(true);
    expect(updateUserBodySchema.safeParse({ roles: [] }).success).toBe(true);
    expect(updateUserBodySchema.safeParse({ roles: ['admin'] }).success).toBe(false);
    expect(updateUserBodySchema.safeParse({ email: 'x@example.test' }).success).toBe(false);
  });

  it('me update takes name only', () => {
    expect(updateMeBodySchema.safeParse({ name: 'Ada' }).success).toBe(true);
    expect(updateMeBodySchema.safeParse({ name: 'Ada', roles: [] }).success).toBe(false);
    expect(updateMeBodySchema.safeParse({}).success).toBe(false);
  });
});

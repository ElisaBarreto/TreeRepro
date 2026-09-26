import { describe, expect, it } from 'vitest';
import { apiKeyListSchema, createApiKeyBodySchema } from './api-keys.ts';

describe('RFC-82 R2, R7 API key contracts', () => {
  it('R2 requires a 1-60 character name, a password and a 6-digit code', () => {
    expect(
      createApiKeyBodySchema.safeParse({ name: 'laptop', password: 'x', code: '123456' }).success,
    ).toBe(true);
    expect(
      createApiKeyBodySchema.safeParse({ name: '', password: 'x', code: '123456' }).success,
    ).toBe(false);
    expect(
      createApiKeyBodySchema.safeParse({ name: 'a'.repeat(61), password: 'x', code: '123456' })
        .success,
    ).toBe(false);
    expect(
      createApiKeyBodySchema.safeParse({ name: 'laptop', password: 'x', code: '12345' }).success,
    ).toBe(false);
    expect(
      createApiKeyBodySchema.safeParse({ name: 'laptop', password: 'x', code: '123456', extra: 1 })
        .success,
    ).toBe(false);
  });

  it('R7 lists keys with a state', () => {
    const parsed = apiKeyListSchema.parse({
      eligible: true,
      keys: [
        {
          id: '0199a1b2-0000-7000-8000-000000000001',
          name: 'laptop',
          prefix: 'AbCdEfGh',
          createdAt: '2026-09-26T10:00:00.000Z',
          expiresAt: '2026-12-25T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
          state: 'active',
        },
      ],
    });
    expect(parsed.keys[0]?.state).toBe('active');
  });

  it('R1 the display prefix is exactly 8 characters', () => {
    const key = {
      id: '0199a1b2-0000-7000-8000-000000000001',
      name: 'laptop',
      prefix: 'AbCdEfG',
      createdAt: '2026-09-26T10:00:00.000Z',
      expiresAt: '2026-12-25T10:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      state: 'active',
    };
    expect(apiKeyListSchema.safeParse({ eligible: true, keys: [key] }).success).toBe(false);
  });
});

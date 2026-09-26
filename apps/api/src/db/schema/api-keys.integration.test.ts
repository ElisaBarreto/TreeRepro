import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../../test/helpers/app.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { apiKeys } from './api-keys.ts';

describe('RFC-82 R1 api_keys table', () => {
  const t = useTestApp();

  it('stores one row per hash and rejects a repeated hash', async () => {
    const { user } = await createUser(t.db);
    const row = {
      userId: user.id,
      name: 'laptop',
      keyHash: 'f'.repeat(64),
      keyPrefix: 'AbCdEfGh',
      expiresAt: new Date(Date.now() + 1000),
    };
    await t.db.insert(apiKeys).values(row);
    await expect(t.db.insert(apiKeys).values(row)).rejects.toThrow();
  });
});

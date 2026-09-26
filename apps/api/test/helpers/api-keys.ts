import { generateApiKey } from '../../src/auth/api-keys.ts';
import { hashToken } from '../../src/auth/tokens.ts';
import { apiKeys } from '../../src/db/schema/api-keys.ts';
import type { TestApp } from './app.ts';
import { adminRoleId } from './roles.ts';
import { createUser } from './users.ts';

/** An admin and a usable key of theirs, valid for a day on the test clock. */
export async function createAdminKey(t: TestApp) {
  const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
  const raw = generateApiKey();
  const [key] = await t.db
    .insert(apiKeys)
    .values({
      userId: user.id,
      name: 'batch',
      keyHash: hashToken(raw),
      keyPrefix: raw.slice(8, 16),
      expiresAt: new Date(t.clock.now + 86_400_000),
    })
    .returning();
  if (!key) throw new Error('createAdminKey: insert returned no row');
  return { user, raw, key, headers: { authorization: `Bearer ${raw}` } };
}

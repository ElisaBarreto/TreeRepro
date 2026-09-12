import type { UserRow } from '../../src/db/schema/users.ts';
import type { TestApp } from './app.ts';

/** Creates a session directly in the store and returns the Cookie header value. */
export async function loginAs(
  t: Pick<TestApp, 'sessions'>,
  user: Pick<UserRow, 'id'>,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<{ cookie: string; rawId: string; id: string }> {
  const { rawId, record } = await t.sessions.create({
    userId: user.id,
    ip: meta.ip ?? '10.0.0.1',
    userAgent: meta.userAgent ?? 'test-agent',
  });
  return { cookie: `__Host-session=${rawId}`, rawId, id: record.id };
}

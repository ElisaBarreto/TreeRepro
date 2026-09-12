import { auditLogEntrySchema } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { AppError } from '../http/errors.ts';
import { recordAudit } from './audit.ts';
import { queryAudit } from './query.ts';

describe('RFC-51 R1-R3 queryAudit', () => {
  const t = useTestDb();

  it('filters by actor, action and period; orders newest first; pages by cursor; decrypts ip and user agent', async () => {
    const { user } = await createUser(t.db);
    const ids: string[] = [];
    for (const [action, ip] of [
      ['auth.login.success', '203.0.113.1'],
      ['auth.logout', '203.0.113.2'],
      ['auth.login.success', '203.0.113.3'],
    ] as const) {
      ids.push((await recordAudit(t.db, { actorUserId: user.id, action, ip, userAgent: 'ua' })).id);
    }
    const all = await queryAudit(t.db, { actor: user.id, limit: 10 });
    expect(all.data.map((e) => e.id)).toEqual([...ids].reverse());
    expect(all.nextCursor).toBeNull();
    for (const e of all.data) expect(auditLogEntrySchema.safeParse(e).success).toBe(true);
    expect(all.data[0]).toMatchObject({
      actorUserId: user.id,
      ip: '203.0.113.3',
      userAgent: 'ua',
      targetType: null,
      metadata: {},
    });

    const logins = await queryAudit(t.db, {
      actor: user.id,
      action: 'auth.login.success',
      limit: 10,
    });
    expect(logins.data.map((e) => e.id)).toEqual([ids[2], ids[0]]);

    const first = await queryAudit(t.db, { actor: user.id, limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const rest = await queryAudit(t.db, {
      actor: user.id,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(rest.data.map((e) => e.id)).toEqual([ids[0]]);
    expect(rest.nextCursor).toBeNull();

    const at = new Date(all.data[1]?.at ?? 0);
    const window = await queryAudit(t.db, { actor: user.id, from: at, to: at, limit: 10 });
    expect(window.data.map((e) => e.id)).toEqual([ids[1]]);
    const future = await queryAudit(t.db, {
      actor: user.id,
      from: new Date(Date.now() + 60_000),
      limit: 10,
    });
    expect(future.data).toEqual([]);
  });

  it('rejects a malformed cursor with VALIDATION_FAILED', async () => {
    await expect(queryAudit(t.db, { cursor: 'nope', limit: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(queryAudit(t.db, { cursor: 'nope', limit: 1 })).rejects.toBeInstanceOf(AppError);
  });
});

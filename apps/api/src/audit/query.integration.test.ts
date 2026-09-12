import { auditLogEntrySchema } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { AppError } from '../http/errors.ts';
import { queryAudit } from './query.ts';

describe('RFC-51 R1-R3 queryAudit', () => {
  const t = useTestDb();

  it('filters by actor, action and period; orders newest first; pages by cursor; decrypts ip and user agent', async () => {
    const { user } = await createUser(t.db);
    const base = Date.now();
    const ids: string[] = [];
    // Explicit, well-separated `at` values keep the `from: at, to: at` window
    // assertion below deterministic: three rows written back-to-back can
    // otherwise share the same millisecond, so a window on one timestamp
    // could match more than the intended row.
    for (const [action, ip, secondsAgo] of [
      ['auth.login.success', '203.0.113.1', 3],
      ['auth.logout', '203.0.113.2', 2],
      ['auth.login.success', '203.0.113.3', 1],
    ] as const) {
      const [row] = await t.db
        .insert(auditLog)
        .values({
          actorUserId: user.id,
          action,
          ip,
          userAgent: 'ua',
          at: new Date(base - secondsAgo * 1000),
        })
        .returning({ id: auditLog.id });
      if (!row) throw new Error('audit insert returned no row');
      ids.push(row.id);
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

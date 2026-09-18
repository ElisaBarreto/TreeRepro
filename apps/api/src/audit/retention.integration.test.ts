import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../test/helpers/db.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { purgeAudit } from './retention.ts';

const DAY = 86_400_000;

describe('RFC-42 R1-R3 audit_log_purge', () => {
  const t = useTestDb();

  it('deletes entries older than two years, keeps younger ones, returns the count', async () => {
    await withRollback(t.db, async (tx) => {
      const [old] = await tx
        .insert(auditLog)
        .values({
          actorUserId: null,
          action: 'auth.logout',
          at: new Date(Date.now() - 3 * 365 * DAY),
        })
        .returning({ id: auditLog.id });
      const [young] = await tx
        .insert(auditLog)
        .values({ actorUserId: null, action: 'auth.logout', at: new Date(Date.now() - 365 * DAY) })
        .returning({ id: auditLog.id });
      const purged = await purgeAudit(tx);
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(
        await tx
          .select()
          .from(auditLog)
          .where(eq(auditLog.id, old?.id ?? '')),
      ).toHaveLength(0);
      expect(
        await tx
          .select()
          .from(auditLog)
          .where(eq(auditLog.id, young?.id ?? '')),
      ).toHaveLength(1);
      expect(await purgeAudit(tx)).toBe(0);
    });
  });

  it('treerepro_app cannot DELETE directly even after setting the purge flag itself', async () => {
    await withRollback(t.db, async (tx) => {
      await tx.execute(sql`set local treerepro.allow_audit_purge = 'on'`);
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.delete(auditLog).where(eq(auditLog.action, 'never.recorded'))),
        ),
      ).rejects.toMatchObject({ code: '42501', message: 'permission denied for table audit_log' });
    });
  });

  it('the function is SECURITY DEFINER owned by the migrator with a fixed search_path', async () => {
    const rows = await t.db.execute(sql`
      select p.prosecdef as secdef, r.rolname as owner, p.proconfig as config
      from pg_proc p join pg_roles r on r.oid = p.proowner
      where p.proname = 'audit_log_purge'
    `);
    expect(rows[0]).toMatchObject({
      secdef: true,
      owner: 'treerepro_migrator',
      config: ['search_path=public, pg_temp'],
    });
  });
});

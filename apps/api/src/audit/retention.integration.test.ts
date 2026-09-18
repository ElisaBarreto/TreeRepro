import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../test/helpers/db.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { jobRuns } from '../db/schema/job-runs.ts';
import { purgeAudit, purgeJobRuns } from './retention.ts';

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

describe('RFC-42 R4 purgeAudit records its own run', () => {
  const t = useTestDb();

  it('writes an audit_purge run that completes with detail.purged', async () => {
    await withRollback(t.db, async (tx) => {
      // Scoped by id difference (Ruling I): `job_runs` has no kind this file
      // could own, and `started_at` defaults to the TRANSACTION timestamp, so
      // neither a global count nor a wall-clock window would hold.
      const audits = () => tx.select().from(jobRuns).where(eq(jobRuns.kind, 'audit_purge'));
      const before = new Set((await audits()).map((r) => r.id));
      const purged = await purgeAudit(tx);
      const created = (await audits()).filter((r) => !before.has(r.id));
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ status: 'completed', detail: { purged }, error: null });
      expect(created[0]?.finishedAt).toBeInstanceOf(Date);
    });
  });
});

describe('RFC-42 R6 job_runs_purge', () => {
  const t = useTestDb();
  const su = useTestDb({ role: 'superuser' });

  it('deletes runs older than one year, keeps younger ones, returns the count', async () => {
    // The app role holds no DELETE on job_runs, so the fixtures are written by
    // the superuser; the whole transaction is rolled back.
    await withRollback(su.db, async (tx) => {
      const [old] = await tx
        .insert(jobRuns)
        .values({
          kind: 'digest',
          startedAt: new Date(Date.now() - 400 * DAY),
          finishedAt: new Date(Date.now() - 400 * DAY),
          status: 'completed',
        })
        .returning({ id: jobRuns.id });
      const [young] = await tx
        .insert(jobRuns)
        .values({
          kind: 'digest',
          startedAt: new Date(Date.now() - 300 * DAY),
          finishedAt: new Date(Date.now() - 300 * DAY),
          status: 'completed',
        })
        .returning({ id: jobRuns.id });
      const purged = await purgeJobRuns(tx);
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(
        await tx
          .select()
          .from(jobRuns)
          .where(eq(jobRuns.id, old?.id ?? '')),
      ).toHaveLength(0);
      expect(
        await tx
          .select()
          .from(jobRuns)
          .where(eq(jobRuns.id, young?.id ?? '')),
      ).toHaveLength(1);
    });
  });

  it('is executable by the app role, which holds no DELETE of its own', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(purgeJobRuns(tx)).resolves.toBeGreaterThanOrEqual(0);
    });
  });

  it('is SECURITY DEFINER owned by the migrator with pg_temp pinned last', async () => {
    const rows = await t.db.execute(sql`
      select p.prosecdef as secdef, r.rolname as owner, p.proconfig as config,
             pg_get_function_result(p.oid) as returns
      from pg_proc p join pg_roles r on r.oid = p.proowner
      where p.proname = 'job_runs_purge'
    `);
    expect(rows[0]).toMatchObject({
      secdef: true,
      owner: 'treerepro_migrator',
      config: ['search_path=public, pg_temp'],
      returns: 'bigint',
    });
  });

  it('is not executable by PUBLIC', async () => {
    const rows = await t.db.execute(sql`
      select has_function_privilege('treerepro_backup', 'job_runs_purge()', 'EXECUTE') as granted
    `);
    expect(rows[0]?.granted).toBe(false);
  });
});

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { jobRuns } from './job-runs.ts';

/** The SQLSTATE PostgreSQL raises for a failed privilege check. */
const INSUFFICIENT_PRIVILEGE = '42501';
/** The SQLSTATE PostgreSQL raises for a violated CHECK constraint. */
const CHECK_VIOLATION = '23514';

describe('RFC-74 R1 job_runs', () => {
  const t = useTestDb();

  it('defaults a new row to running, now, an empty detail and no finish', async () => {
    await withRollback(t.db, async (tx) => {
      const [row] = await tx.insert(jobRuns).values({ kind: 'digest' }).returning();
      expect(row).toMatchObject({ kind: 'digest', status: 'running', detail: {}, error: null });
      expect(row?.finishedAt).toBeNull();
      expect(row?.startedAt).toBeInstanceOf(Date);
      expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('rejects an unknown kind (23514)', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.execute(sql`insert into job_runs (kind) values ('backup')`)),
        ),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'job_runs_kind_check',
      });
    });
  });

  it('rejects an unknown status (23514)', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.execute(sql`insert into job_runs (kind, status) values ('digest', 'cancelled')`),
          ),
        ),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'job_runs_status_check',
      });
    });
  });
});

describe('RFC-74 R7 job_runs is append-only by grant', () => {
  const t = useTestDb();

  it('treerepro_app holds SELECT, INSERT and UPDATE but neither DELETE nor TRUNCATE', async () => {
    const rows = await t.db.execute(sql`
      select privilege_type, has_table_privilege('treerepro_app', 'job_runs', privilege_type) as granted
      from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as privilege_type
    `);
    expect(Object.fromEntries(rows.map((r) => [r.privilege_type, r.granted]))).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: true,
      DELETE: false,
      TRUNCATE: false,
    });
  });

  it('treerepro_app cannot DELETE a row it inserted itself', async () => {
    await withRollback(t.db, async (tx) => {
      const [row] = await tx
        .insert(jobRuns)
        .values({ kind: 'digest' })
        .returning({ id: jobRuns.id });
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.delete(jobRuns).where(eq(jobRuns.id, row?.id ?? ''))),
        ),
      ).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: 'permission denied for table job_runs',
      });
    });
  });

  it('treerepro_app cannot TRUNCATE the table', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.execute(sql`truncate table job_runs`))),
      ).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: 'permission denied for table job_runs',
      });
    });
  });
});

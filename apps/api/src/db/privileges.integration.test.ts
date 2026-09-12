import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../test/helpers/db.ts';
import { recordAudit } from '../audit/audit.ts';
import { auditLog } from '../db/schema/audit-log.ts';

/** The SQLSTATE PostgreSQL raises for a failed privilege check. */
const INSUFFICIENT_PRIVILEGE = '42501';

describe('RFC-10 R7 treerepro_app is the runtime role', () => {
  const t = useTestDb();

  it('runs the suite as treerepro_app', async () => {
    const rows = await t.db.execute(sql`select current_user as role`);
    expect(rows[0]?.role).toBe('treerepro_app');
  });

  it('treerepro_app cannot create tables', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.execute(sql`create table privilege_probe (x int)`)),
        ),
      ).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: 'permission denied for schema public',
      });
    });
  });

  it('treerepro_app cannot alter tables', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.execute(sql`alter table audit_log add column probe int`)),
        ),
      ).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: 'must be owner of table audit_log',
      });
    });
  });
});

describe('RFC-41 R9 treerepro_app privileges on audit_log', () => {
  const t = useTestDb();
  const su = useTestDb({ role: 'superuser' });

  it('holds SELECT and INSERT but neither UPDATE, DELETE nor TRUNCATE', async () => {
    const rows = await t.db.execute(sql`
      select privilege_type, has_table_privilege('treerepro_app', 'audit_log', privilege_type) as granted
      from unnest(array['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'TRUNCATE']) as privilege_type
    `);
    expect(Object.fromEntries(rows.map((r) => [r.privilege_type, r.granted]))).toEqual({
      SELECT: true,
      INSERT: true,
      DELETE: false,
      UPDATE: false,
      TRUNCATE: false,
    });
  });

  it('treerepro_app cannot UPDATE audit_log even when the trigger is disabled', async () => {
    // The superuser disables the trigger and then acts as the app role, all in
    // one transaction that is rolled back, so the trigger is never left off.
    await withRollback(su.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.logout' });
      await tx.execute(sql`alter table audit_log disable trigger audit_log_append_only`);
      await tx.execute(sql`set local role treerepro_app`);
      const who = await tx.execute(sql`select current_user as role`);
      expect(who[0]?.role).toBe('treerepro_app');
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.update(auditLog).set({ action: 'auth.login.success' }).where(eq(auditLog.id, id)),
          ),
        ),
      ).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: 'permission denied for table audit_log',
      });
    });
    const enabled = await su.db.execute(
      sql`select tgenabled from pg_trigger where tgname = 'audit_log_append_only'`,
    );
    expect(enabled[0]?.tgenabled).toBe('O');
  });
});

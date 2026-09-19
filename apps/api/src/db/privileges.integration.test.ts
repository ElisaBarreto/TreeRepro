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

describe('RFC-10 R7 treerepro_backup is read-only and passwords are stored as SCRAM verifiers', () => {
  const su = useTestDb({ role: 'superuser' });

  it('treerepro_backup can read every table but write none', async () => {
    await withRollback(su.db, async (tx) => {
      await tx.execute(sql`set local role treerepro_backup`);
      const who = await tx.execute(sql`select current_user as role`);
      expect(who[0]?.role).toBe('treerepro_backup');
      const readable = await tx.execute(sql`
        select bool_and(has_table_privilege(c.oid, 'SELECT')) as all_readable,
               bool_or(has_table_privilege(c.oid, 'INSERT')) as any_writable
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
      `);
      expect(readable[0]).toEqual({ all_readable: true, any_writable: false });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(auditLog).values({ actorUserId: null, action: 'auth.logout' }),
          ),
        ),
      ).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: 'permission denied for table audit_log',
      });
    });
  });

  it('the init script stored SCRAM-SHA-256 verifiers for every project role', async () => {
    const rows = await su.db.execute(sql`
      select rolname, rolpassword like 'SCRAM-SHA-256$%' as scram
      from pg_authid where starts_with(rolname, 'treerepro_') order by rolname
    `);
    expect(rows).toEqual([
      { rolname: 'treerepro_app', scram: true },
      { rolname: 'treerepro_backup', scram: true },
      { rolname: 'treerepro_migrator', scram: true },
    ]);
  });
});

describe('RFC-42 R2, R6, RFC-69 R3 SECURITY DEFINER functions pin search_path with pg_temp last', () => {
  const t = useTestDb();

  // Unless pg_temp is listed, PostgreSQL searches it FIRST for relations, so a
  // caller holding TEMPORARY (every role, through the default PUBLIC grant)
  // could shadow a table the definer body resolves. Naming it last puts it
  // after public, where it can shadow nothing. The sweep covers every definer
  // in the schema so the next one cannot ship without the clause.
  it('every SECURITY DEFINER function in public names pg_temp last in search_path', async () => {
    const rows = await t.db.execute(sql`
      select p.proname as name, p.proconfig as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by p.proname
    `);
    // The inventory is explicit so a new definer is added here on purpose, not
    // discovered: the loop below would pass vacuously on an empty result.
    expect(rows.map((r) => r.name)).toEqual([
      'audit_log_purge',
      'job_runs_purge',
      'trait_records_reference_usage',
    ]);
    for (const row of rows) {
      const config = row.config as string[] | null;
      const searchPath = config?.find((c) => c.startsWith('search_path='));
      expect(searchPath, `${row.name} pins no search_path`).toBeDefined();
      const schemas = searchPath
        ?.slice('search_path='.length)
        .split(',')
        .map((s) => s.trim());
      expect(schemas, `${row.name} must pin exactly public, pg_temp`).toEqual([
        'public',
        'pg_temp',
      ]);
    }
  });
});

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';

describe('RFC-10 R6-R7 database client and migrations', () => {
  const t = useTestDb();

  it('executes a parameterized query', async () => {
    const value = 41;
    const rows = await t.db.execute(sql`select ${value}::int + 1 as answer`);
    expect(rows[0]).toEqual({ answer: 42 });
  });

  it('applied the migrations: audit_log has the RFC-41 R1 columns', async () => {
    const rows = await t.db.execute(
      sql`select column_name from information_schema.columns where table_name = 'audit_log' order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'at',
      'actor_user_id',
      'action',
      'target_type',
      'target_id',
      'ip',
      'user_agent',
      'metadata',
    ]);
  });

  it('RFC-02 R8 uuidv7() is available', async () => {
    const rows = await t.db.execute(sql`select uuidv7()::text as id`);
    expect(String(rows[0]?.id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('RFC-01 R4 withRollback leaves no trace', async () => {
    await withRollback(t.db, async (tx) => {
      await tx.execute(sql`create table rollback_probe (x int)`);
    });
    const rows = await t.db.execute(sql`select to_regclass('public.rollback_probe') as name`);
    expect(rows[0]?.name).toBeNull();
  });
});

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import type { DbExecutor } from '../client.ts';
import { contestEvents, contestLevels, contestRecords, contests } from './contests.ts';

const CONTEST_TABLES = ['contests', 'contest_levels', 'contest_records', 'contest_events'];

/** A categorical contest naming level `a` and creating the record of level `b`. */
async function seedContest(db: DbExecutor) {
  const { user } = await createUser(db);
  const ref = await createReference(db);
  const trait = await createTrait(db, { levels: ['a', 'b'] });
  const sp = await createSpecies(db);
  const [la, lb] = trait.levels as [{ id: string; key: string }, { id: string; key: string }];
  const record = await createRecord(db, {
    speciesId: sp.id,
    traitId: trait.id,
    valueText: 'b',
    levelId: lb.id,
    primaryReferenceId: ref.id,
    origin: 'manual',
    createdBy: user.id,
    intent: 'contest',
  });
  const [contest] = await db
    .insert(contests)
    .values({ speciesId: sp.id, traitId: trait.id, createdBy: user.id })
    .returning();
  if (!contest) throw new Error('seedContest: no contest');
  await db.insert(contestLevels).values({ contestId: contest.id, levelId: la.id });
  await db.insert(contestRecords).values({ contestId: contest.id, recordId: record.id });
  const [event] = await db
    .insert(contestEvents)
    .values({ contestId: contest.id, actorId: user.id, kind: 'resolve' })
    .returning();
  if (!event) throw new Error('seedContest: no event');
  return { user, contest, event, record, levelId: la.id };
}

describe('RFC-63 R4, R14 contest storage', () => {
  const t = useTestDb();
  const su = useTestDb({ role: 'superuser' });

  it('stores a contest with its levels, records and events', async () => {
    await withRollback(t.db, async (tx) => {
      const { contest, user, record, levelId } = await seedContest(tx);
      expect(contest.createdBy).toBe(user.id);
      expect(
        await tx.select().from(contestLevels).where(eq(contestLevels.contestId, contest.id)),
      ).toEqual([{ contestId: contest.id, levelId }]);
      expect(
        await tx.select().from(contestRecords).where(eq(contestRecords.contestId, contest.id)),
      ).toEqual([{ contestId: contest.id, recordId: record.id }]);
    });
  });

  it('treerepro_app holds SELECT and INSERT but neither UPDATE, DELETE nor TRUNCATE', async () => {
    for (const table of CONTEST_TABLES) {
      const rows = await t.db.execute(sql`
        select privilege_type, has_table_privilege('treerepro_app', ${table}, privilege_type) as granted
        from unnest(array['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'TRUNCATE']) as privilege_type
      `);
      expect(Object.fromEntries(rows.map((r) => [r.privilege_type, r.granted])), table).toEqual({
        SELECT: true,
        INSERT: true,
        DELETE: false,
        UPDATE: false,
        TRUNCATE: false,
      });
    }
  });

  it('the trigger refuses UPDATE and DELETE on every contest table, even for the owner', async () => {
    await withRollback(su.db, async (tx) => {
      const { contest } = await seedContest(tx);
      const where = sql`contest_id = ${contest.id}`;
      const statements = [
        sql`update contests set created_at = now() where id = ${contest.id}`,
        sql`delete from contests where id = ${contest.id}`,
        ...['contest_levels', 'contest_records', 'contest_events'].flatMap((table) => [
          sql`update ${sql.identifier(table)} set contest_id = contest_id where ${where}`,
          sql`delete from ${sql.identifier(table)} where ${where}`,
        ]),
      ];
      for (const statement of statements) {
        await expect(
          unwrapDbError(tx.transaction((sp) => sp.execute(statement))),
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  it('contest_events: kind is resolve or withdraw, once each per contest', async () => {
    await withRollback(t.db, async (tx) => {
      const { contest, user } = await seedContest(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.execute(
              sql`insert into contest_events (contest_id, actor_id, kind) values (${contest.id}, ${user.id}, 'dispute')`,
            ),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(contestEvents)
              .values({ contestId: contest.id, actorId: user.id, kind: 'resolve' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await tx
        .insert(contestEvents)
        .values({ contestId: contest.id, actorId: user.id, kind: 'withdraw' });
    });
  });

  it('contest_records: a record belongs to one contest', async () => {
    await withRollback(t.db, async (tx) => {
      const { contest, record, user } = await seedContest(tx);
      const [other] = await tx
        .insert(contests)
        .values({ speciesId: contest.speciesId, traitId: contest.traitId, createdBy: user.id })
        .returning();
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp
              .insert(contestRecords)
              .values({ contestId: other?.id as string, recordId: record.id }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});

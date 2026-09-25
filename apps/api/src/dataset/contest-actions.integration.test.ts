import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createContest,
  createContestEvent,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { contestEvents } from '../db/schema/contests.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import { resolveContest, withdrawContest } from './contest-actions.ts';
import { contestResolvedSql, contestWithdrawnSql } from './contests.ts';
import { getRecord } from './records.ts';
import { speciesTraitSummary } from './summary.ts';

/** blue (bo) is contested by ana, who stated green (a record of hers) or nothing. */
async function contested(db: DbExecutor, withRecord: boolean) {
  const { user: ana } = await createUser(db);
  const { user: bo } = await createUser(db);
  const ref = await createReference(db);
  const trait = await createTrait(db, { levels: ['blue', 'green'] });
  const sp = await createSpecies(db);
  const [blue, green] = trait.levels.map((l) => l.id) as [string, string];
  const rec = (levelId: string, key: string, by: string) =>
    createRecord(db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: key,
      levelId,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: by,
    });
  await rec(blue, 'blue', bo.id);
  const greenRec = withRecord ? await rec(green, 'green', ana.id) : null;
  const contest = await createContest(db, {
    speciesId: sp.id,
    traitId: trait.id,
    createdBy: ana.id,
    levelIds: [blue],
    recordIds: greenRec ? [greenRec.id] : [],
  });
  return { ana, bo, trait, sp, blue, greenRec, contest };
}

async function state(db: DbExecutor, contestId: string) {
  const [row] = (await db.execute(sql`
    select ${contestWithdrawnSql('k')} as withdrawn, ${contestResolvedSql('k')} as resolved
    from contests k where k.id = ${contestId}::uuid`)) as unknown as {
    withdrawn: boolean;
    resolved: boolean;
  }[];
  return row;
}

async function traitContested(db: DbExecutor, speciesId: string, traitId: string) {
  return (await speciesTraitSummary(db, UNRESTRICTED, speciesId))
    ?.flatMap((c) => c.traits)
    .find((x) => x.trait.id === traitId)?.contested;
}

describe('RFC-65 R15, R16 Keep both', () => {
  const t = useTestDb();

  it('resolves the contest, clears the flag, and is idempotent', async () => {
    const f = await contested(t.db, false);
    const { user: reviewer } = await createUser(t.db);
    expect(await traitContested(t.db, f.sp.id, f.trait.id)).toBe(true);
    await resolveContest(t.db, UNRESTRICTED, { contestId: f.contest.id, actorId: reviewer.id });
    await resolveContest(t.db, UNRESTRICTED, { contestId: f.contest.id, actorId: reviewer.id });
    expect(await state(t.db, f.contest.id)).toEqual({ withdrawn: false, resolved: true });
    expect(
      await t.db.select().from(contestEvents).where(eq(contestEvents.contestId, f.contest.id)),
    ).toHaveLength(1);
    expect(await traitContested(t.db, f.sp.id, f.trait.id)).toBe(false);
  });

  it('an unknown or withdrawn contest, or one naming a level the actor cannot see, is 404', async () => {
    const f = await contested(t.db, false);
    const { user: reviewer } = await createUser(t.db);
    await expect(
      resolveContest(t.db, UNRESTRICTED, {
        contestId: '00000000-0000-4000-8000-000000000000',
        actorId: reviewer.id,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, f.blue));
    await expect(
      resolveContest(t.db, RESTRICTED, { contestId: f.contest.id, actorId: reviewer.id }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(
      withdrawContest(t.db, RESTRICTED, {
        contestId: f.contest.id,
        actorId: f.ana.id,
        canWithdrawAny: false,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await createContestEvent(t.db, {
      contestId: f.contest.id,
      actorId: f.ana.id,
      kind: 'withdraw',
    });
    await expect(
      resolveContest(t.db, UNRESTRICTED, { contestId: f.contest.id, actorId: reviewer.id }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
});

describe('RFC-65 R16 Withdraw contest', () => {
  const t = useTestDb();

  it('withdraws the records the contest created; the contest reads withdrawn', async () => {
    const f = await contested(t.db, true);
    await withdrawContest(t.db, UNRESTRICTED, {
      contestId: f.contest.id,
      actorId: f.ana.id,
      canWithdrawAny: false,
    });
    expect(await getRecord(t.db, UNRESTRICTED, f.greenRec?.id as string)).toBeNull();
    expect(await state(t.db, f.contest.id)).toEqual({ withdrawn: true, resolved: false });
    expect(
      await t.db.select().from(contestEvents).where(eq(contestEvents.contestId, f.contest.id)),
    ).toEqual([]);
    expect(await traitContested(t.db, f.sp.id, f.trait.id)).toBe(false);
    await expect(
      withdrawContest(t.db, UNRESTRICTED, {
        contestId: f.contest.id,
        actorId: f.ana.id,
        canWithdrawAny: false,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('a contest that created no record is withdrawn by an event', async () => {
    const f = await contested(t.db, false);
    await withdrawContest(t.db, UNRESTRICTED, {
      contestId: f.contest.id,
      actorId: f.ana.id,
      canWithdrawAny: false,
    });
    const events = await t.db
      .select({ kind: contestEvents.kind, actorId: contestEvents.actorId })
      .from(contestEvents)
      .where(eq(contestEvents.contestId, f.contest.id));
    expect(events).toEqual([{ kind: 'withdraw', actorId: f.ana.id }]);
    expect(await state(t.db, f.contest.id)).toEqual({ withdrawn: true, resolved: false });
  });

  it('refuses anyone but the author or a records.withdraw holder; a resolved contest may still be withdrawn', async () => {
    const f = await contested(t.db, false);
    await expect(
      withdrawContest(t.db, UNRESTRICTED, {
        contestId: f.contest.id,
        actorId: f.bo.id,
        canWithdrawAny: false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await resolveContest(t.db, UNRESTRICTED, { contestId: f.contest.id, actorId: f.bo.id });
    await withdrawContest(t.db, UNRESTRICTED, {
      contestId: f.contest.id,
      actorId: f.bo.id,
      canWithdrawAny: true,
    });
    expect(await state(t.db, f.contest.id)).toEqual({ withdrawn: true, resolved: true });
  });
});

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
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
import type { Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import { contestResolvedSql, contestStandingSql, contestWithdrawnSql } from './contests.ts';
import { listRecords } from './records.ts';
import { speciesTraitSummary } from './summary.ts';

/** red (ana), blue (ana), blue (bo, ref2), orange (bo) on a trait of its own. */
async function colours(db: DbExecutor) {
  const { user: ana } = await createUser(db);
  const { user: bo } = await createUser(db);
  const { user: cy } = await createUser(db);
  const ref = await createReference(db);
  const ref2 = await createReference(db);
  const trait = await createTrait(db, { levels: ['red', 'blue', 'orange', 'green'] });
  const sp = await createSpecies(db);
  const level = (k: string) => trait.levels.find((l) => l.key === k)?.id as string;
  const rec = (key: string, by: string, primary = ref.id) =>
    createRecord(db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: key,
      levelId: level(key),
      primaryReferenceId: primary,
      origin: 'manual',
      createdBy: by,
    });
  const red = await rec('red', ana.id);
  const blue1 = await rec('blue', ana.id);
  const blue2 = await rec('blue', bo.id, ref2.id);
  const orange = await rec('orange', bo.id);
  return { ana, bo, cy, ref, ref2, trait, sp, level, rec, red, blue1, blue2, orange };
}

async function items(db: DbExecutor, v: Visibility, speciesId: string, traitId: string) {
  const { data } = await listRecords(db, v, { speciesId, traitId, limit: 50 });
  return new Map(data.map((r) => [r.id, r]));
}

async function summaryOf(db: DbExecutor, v: Visibility, speciesId: string, traitId: string) {
  const summary = await speciesTraitSummary(db, v, speciesId);
  return summary?.flatMap((c) => c.traits).find((x) => x.trait.id === traitId);
}

describe('RFC-63 R14 contested is derived from contest storage', () => {
  const t = useTestDb();

  it('RFC-63 R8, R10 a contest naming blue contests every visible blue record and nothing else; counts are distinct users', async () => {
    const f = await colours(t.db);
    await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.bo.id, kind: 'confirm' });
    await createAnnotation(t.db, {
      recordId: f.blue1.id,
      actorId: f.bo.id,
      kind: 'confirm',
      referenceId: f.ref2.id,
    });
    await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.cy.id, kind: 'confirm' });
    await createAnnotation(t.db, { recordId: f.blue2.id, actorId: f.cy.id, kind: 'confirm' });
    // cy states green: a new record, contesting red, blue and orange; ana
    // contests blue alone with no record of her own.
    const green = await f.rec('green', f.cy.id, f.ref2.id);
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.cy.id,
      levelIds: [f.level('blue')],
      recordIds: [green.id],
    });
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.ana.id,
      levelIds: [f.level('blue')],
    });
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.cy.id,
      levelIds: [f.level('blue')],
    });

    const byId = await items(t.db, UNRESTRICTED, f.sp.id, f.trait.id);
    expect(byId.get(f.blue1.id)).toMatchObject({
      validationCount: 2,
      contestCount: 2,
      contested: true,
      review: 'contested',
    });
    expect(byId.get(f.blue2.id)).toMatchObject({
      validationCount: 1,
      contestCount: 2,
      contested: true,
    });
    expect(byId.get(f.red.id)).toMatchObject({ contested: false, contestCount: 0 });
    expect(byId.get(f.orange.id)).toMatchObject({ contested: false, contestCount: 0 });
    expect(byId.get(green.id)).toMatchObject({ contested: false, contestCount: 0 });

    const trait = await summaryOf(t.db, UNRESTRICTED, f.sp.id, f.trait.id);
    expect(trait?.contested).toBe(true);
    expect(trait?.levels).toEqual(
      expect.arrayContaining([
        { levelId: f.level('blue'), key: 'blue', count: 2, validationCount: 2, contested: true },
        { levelId: f.level('red'), key: 'red', count: 1, validationCount: 0, contested: false },
        {
          levelId: f.level('orange'),
          key: 'orange',
          count: 1,
          validationCount: 0,
          contested: false,
        },
        { levelId: f.level('green'), key: 'green', count: 1, validationCount: 0, contested: false },
      ]),
    );
  });

  it('a contest on one species naming blue does not contest another species blue record', async () => {
    const f = await colours(t.db);
    const other = await createSpecies(t.db);
    const otherBlue = await createRecord(t.db, {
      speciesId: other.id,
      traitId: f.trait.id,
      valueText: 'blue',
      levelId: f.level('blue'),
      primaryReferenceId: f.ref.id,
      origin: 'manual',
      createdBy: f.bo.id,
    });
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.cy.id,
      levelIds: [f.level('blue')],
    });
    expect((await items(t.db, UNRESTRICTED, f.sp.id, f.trait.id)).get(f.blue1.id)).toMatchObject({
      contested: true,
      contestCount: 1,
    });
    const otherItems = await items(t.db, UNRESTRICTED, other.id, f.trait.id);
    expect(otherItems.get(otherBlue.id)).toMatchObject({ contested: false, contestCount: 0 });
    expect((await summaryOf(t.db, UNRESTRICTED, other.id, f.trait.id))?.contested).toBe(false);
  });

  it('RFC-65 R15 resolve, withdraw event, withdrawing the created records, or emptying the level clears the flag', async () => {
    for (const end of ['resolve', 'withdraw event', 'withdraw records', 'empty level'] as const) {
      const f = await colours(t.db);
      const green = await f.rec('green', f.cy.id, f.ref2.id);
      const contest = await createContest(t.db, {
        speciesId: f.sp.id,
        traitId: f.trait.id,
        createdBy: f.cy.id,
        levelIds: [f.level('blue')],
        recordIds: end === 'withdraw event' ? [] : [green.id],
      });
      expect((await summaryOf(t.db, UNRESTRICTED, f.sp.id, f.trait.id))?.contested, end).toBe(true);
      if (end === 'resolve')
        await createContestEvent(t.db, {
          contestId: contest.id,
          actorId: f.ana.id,
          kind: 'resolve',
        });
      if (end === 'withdraw event')
        await createContestEvent(t.db, {
          contestId: contest.id,
          actorId: f.cy.id,
          kind: 'withdraw',
        });
      if (end === 'withdraw records')
        await createAnnotation(t.db, { recordId: green.id, actorId: f.cy.id, kind: 'withdraw' });
      if (end === 'empty level') {
        await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.ana.id, kind: 'withdraw' });
        await createAnnotation(t.db, { recordId: f.blue2.id, actorId: f.ana.id, kind: 'withdraw' });
      }
      const trait = await summaryOf(t.db, UNRESTRICTED, f.sp.id, f.trait.id);
      expect(trait?.contested, end).toBe(false);
      expect(
        trait?.levels?.every((l) => !l.contested),
        end,
      ).toBe(true);
      const byId = await items(t.db, UNRESTRICTED, f.sp.id, f.trait.id);
      expect(
        [...byId.values()].every((r) => !r.contested && r.review !== 'contested'),
        end,
      ).toBe(true);
      // RFC-63 R8: a resolved contest still counts; a withdrawn one does not.
      if (end === 'resolve') expect(byId.get(f.blue1.id)?.contestCount).toBe(1);
      if (end === 'withdraw event' || end === 'withdraw records')
        expect(byId.get(f.blue1.id)?.contestCount, end).toBe(0);
    }
  });

  it('a level emptied and then given a new visible record is contested again by a standing contest', async () => {
    const f = await colours(t.db);
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.cy.id,
      levelIds: [f.level('blue')],
    });
    await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.ana.id, kind: 'withdraw' });
    await createAnnotation(t.db, { recordId: f.blue2.id, actorId: f.ana.id, kind: 'withdraw' });
    expect((await summaryOf(t.db, UNRESTRICTED, f.sp.id, f.trait.id))?.contested).toBe(false);
    const blue3 = await f.rec('blue', f.bo.id, (await createReference(t.db)).id);
    expect((await summaryOf(t.db, UNRESTRICTED, f.sp.id, f.trait.id))?.contested).toBe(true);
    expect((await items(t.db, UNRESTRICTED, f.sp.id, f.trait.id)).get(blue3.id)).toMatchObject({
      contested: true,
      review: 'contested',
    });
  });

  it('a quantitative contest contests only the record it responds to', async () => {
    const { user } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const sp = await createSpecies(t.db);
    const q = (v: number, by: string, extra: object = {}) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: String(v),
        numericValue: v,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: by,
        ...extra,
      });
    const a = await q(1, user.id);
    const b = await q(2, user.id);
    const c = await q(3, other.id, { intent: 'contest', respondsToRecordId: a.id });
    await createContest(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      createdBy: other.id,
      recordIds: [c.id],
    });
    const byId = await items(t.db, UNRESTRICTED, sp.id, trait.id);
    expect(byId.get(a.id)).toMatchObject({ contested: true, contestCount: 1 });
    expect(byId.get(b.id)).toMatchObject({ contested: false, contestCount: 0 });
    expect(byId.get(c.id)).toMatchObject({ contested: false, contestCount: 0 });
    expect((await summaryOf(t.db, UNRESTRICTED, sp.id, trait.id))?.contested).toBe(true);

    await createAnnotation(t.db, { recordId: c.id, actorId: other.id, kind: 'withdraw' });
    expect((await items(t.db, UNRESTRICTED, sp.id, trait.id)).get(a.id)).toMatchObject({
      contested: false,
      contestCount: 0,
    });
  });

  it('RFC-33 R2 a contest naming a level invisible to the viewer contests nothing for that viewer', async () => {
    const f = await colours(t.db);
    const purple = (
      await t.db
        .insert(traitLevels)
        .values({ traitId: f.trait.id, key: 'purple', sortOrder: 9, active: false })
        .returning({ id: traitLevels.id })
    )[0]?.id as string;
    const onPurple = await createRecord(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      valueText: 'purple',
      levelId: purple,
      primaryReferenceId: f.ref.id,
      origin: 'manual',
      createdBy: f.ana.id,
    });
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.cy.id,
      levelIds: [purple],
    });
    const restricted = await items(t.db, RESTRICTED, f.sp.id, f.trait.id);
    expect(restricted.has(onPurple.id)).toBe(false);
    expect([...restricted.values()].every((r) => !r.contested)).toBe(true);
    expect((await summaryOf(t.db, RESTRICTED, f.sp.id, f.trait.id))?.contested).toBe(false);

    expect((await items(t.db, UNRESTRICTED, f.sp.id, f.trait.id)).get(onPurple.id)?.contested).toBe(
      true,
    );
    expect((await summaryOf(t.db, UNRESTRICTED, f.sp.id, f.trait.id))?.contested).toBe(true);
  });

  it('RFC-63 R6 review states: contested > validated > unvalidated; dispute and neutral are ignored', async () => {
    const f = await colours(t.db);
    await createAnnotation(t.db, { recordId: f.red.id, actorId: f.bo.id, kind: 'confirm' });
    await createAnnotation(t.db, { recordId: f.red.id, actorId: f.cy.id, kind: 'dispute' });
    await createAnnotation(t.db, { recordId: f.orange.id, actorId: f.cy.id, kind: 'dispute' });
    await createAnnotation(t.db, { recordId: f.blue1.id, actorId: f.bo.id, kind: 'confirm' });
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.cy.id,
      levelIds: [f.level('blue')],
    });
    const byId = await items(t.db, UNRESTRICTED, f.sp.id, f.trait.id);
    expect(byId.get(f.red.id)?.review).toBe('validated');
    expect(byId.get(f.orange.id)?.review).toBe('unvalidated');
    expect(byId.get(f.blue1.id)?.review).toBe('contested');
    expect(byId.get(f.blue2.id)?.review).toBe('contested');
  });

  it('contestWithdrawnSql, contestResolvedSql and contestStandingSql read the contest row', async () => {
    const f = await colours(t.db);
    const green = await f.rec('green', f.cy.id, f.ref2.id);
    const withRecord = await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.cy.id,
      levelIds: [f.level('blue')],
      recordIds: [green.id],
    });
    const bare = await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.ana.id,
      levelIds: [f.level('orange')],
    });
    const state = async (id: string) => {
      const [row] = (await t.db.execute(sql`
        select ${contestWithdrawnSql('k')} as withdrawn, ${contestResolvedSql('k')} as resolved,
          ${contestStandingSql(UNRESTRICTED, 'k')} as standing
        from contests k where k.id = ${id}`)) as unknown as {
        withdrawn: boolean;
        resolved: boolean;
        standing: boolean;
      }[];
      return row;
    };
    expect(await state(withRecord.id)).toEqual({
      withdrawn: false,
      resolved: false,
      standing: true,
    });
    await createContestEvent(t.db, { contestId: bare.id, actorId: f.bo.id, kind: 'resolve' });
    expect(await state(bare.id)).toEqual({ withdrawn: false, resolved: true, standing: false });
    await createAnnotation(t.db, { recordId: green.id, actorId: f.cy.id, kind: 'withdraw' });
    expect(await state(withRecord.id)).toEqual({
      withdrawn: true,
      resolved: false,
      standing: false,
    });
  });
});

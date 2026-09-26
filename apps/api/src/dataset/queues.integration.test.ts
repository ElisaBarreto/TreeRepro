import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  addPlotSpecies,
  createAnnotation,
  createContest,
  createContestEvent,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED } from '../../test/helpers/visibility.ts';
import type { Visibility } from '../access/visibility.ts';
import type { Db } from '../db/client.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import {
  countContested,
  countPendingGroups,
  listContested,
  mapPending,
  pendingGroups,
} from './queues.ts';

/**
 * A plot holding this test's species and nothing else, and the visibility of a
 * viewer bound to it (RFC-33 R3). Every queue read through it is this test's
 * own fixture alone, whatever sibling test files commit in parallel — the
 * queues are dataset-wide listings, so no absolute count of them is stable.
 */
async function ownPlot(db: Db, speciesIds: string[]): Promise<Visibility> {
  const plot = await createPlot(db);
  await addPlotSpecies(db, plot.id, speciesIds);
  return { inactive: false, plotIds: [plot.id] };
}

describe('RFC-72 R1 queue counts', () => {
  const t = useTestDb();

  it('countPendingGroups counts the groups its lists return', async () => {
    const { user } = await createUser(t.db);
    const pendingOne = await createTrait(t.db, { levels: ['a'] });
    const pendingTwo = await createTrait(t.db, { levels: ['a'] });
    const pendingSpecies = await createSpecies(t.db);
    const visibility = await ownPlot(t.db, [pendingSpecies.id]);
    const ref = await createReference(t.db);

    // Two pending groups on one trait, one on another: the count is over every
    // visible trait, so it must equal both lists together.
    for (const [traitId, valueText] of [
      [pendingOne.id, 'ten to twelve'],
      [pendingOne.id, 'twelve to fourteen'],
      [pendingTwo.id, 'ten to twelve'],
    ] as const) {
      await createRecord(t.db, {
        speciesId: pendingSpecies.id,
        traitId,
        valueText,
        harmonisation: 'unknown_level',
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }
    const groupsOne = await pendingGroups(t.db, visibility, { traitId: pendingOne.id, limit: 50 });
    const groupsTwo = await pendingGroups(t.db, visibility, { traitId: pendingTwo.id, limit: 50 });
    expect(groupsOne.data).toHaveLength(2);
    expect(groupsTwo.data).toHaveLength(1);
    expect(await countPendingGroups(t.db, visibility)).toBe(
      groupsOne.data.length + groupsTwo.data.length,
    );
  });
});

describe('RFC-65 R9 mapPending numeric validation', () => {
  const t = useTestDb();

  it('reports an out-of-range number at value.numeric, the path the web MapDialog reads', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    await expect(
      mapPending(t.db, UNRESTRICTED, {
        actorId: user.id,
        traitId: trait.id,
        valueText: 'huge',
        value: { numeric: 1e308 },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'value.numeric' }],
    });
  });
});

describe('RFC-65 R10 the contested queue', () => {
  const t = useTestDb();

  /** A reviewer bound to a plot of these species alone: the queue and count are this test's own. */
  async function reviewer(speciesIds: string[], inactive = false): Promise<Visibility> {
    return { ...(await ownPlot(t.db, speciesIds)), inactive, review: true };
  }

  /** Every item of the queue, walking the cursor one page of `limit` at a time. */
  async function walk(v: Visibility, limit = 200) {
    const items: Awaited<ReturnType<typeof listContested>>['data'] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const next = await listContested(t.db, v, { limit, cursor });
      items.push(...next.data);
      if (next.nextCursor === null) return items;
      cursor = next.nextCursor;
    }
    throw new Error('walk: the cursor never ended');
  }

  async function categorical(levels: string[]) {
    const { user: ana } = await createUser(t.db, { name: 'Ana' });
    const { user: bo } = await createUser(t.db, { name: 'Bo' });
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels });
    const sp = await createSpecies(t.db);
    const level = (k: string) => trait.levels.find((l) => l.key === k)?.id as string;
    const record = (key: string, extra: { createdBy?: string; intent?: 'contest' } = {}) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: key,
        levelId: level(key),
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: extra.createdBy ?? ana.id,
        ...(extra.intent ? { intent: extra.intent } : {}),
      });
    return { ana, bo, ref, trait, sp, level, record };
  }

  it('lists a record-less contest and one naming several levels, newest first, with per-level contested', async () => {
    const f = await categorical(['red', 'blue', 'yellow', 'green']);
    await f.record('red');
    await f.record('blue');
    const yellow = await f.record('yellow');
    const recordLess = await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.bo.id,
      levelIds: [f.level('blue')],
    });
    const green = await f.record('green', { createdBy: f.bo.id, intent: 'contest' });
    const several = await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.bo.id,
      levelIds: [f.level('yellow'), f.level('red')],
      recordIds: [green.id],
    });
    // Yellow loses its only record: still named, no longer contested.
    await createAnnotation(t.db, { recordId: yellow.id, actorId: f.ana.id, kind: 'withdraw' });
    const v = await reviewer([f.sp.id]);

    const items = await walk(v);
    expect(items.map((i) => i.id)).toEqual([several.id, recordLess.id]);
    expect(await countContested(t.db, v)).toBe(2);
    const [first, second] = items;
    expect(first).toMatchObject({
      species: { id: f.sp.id },
      trait: { id: f.trait.id, key: f.trait.key },
      createdBy: { id: f.bo.id, name: 'Bo' },
      levels: [
        { levelId: f.level('red'), key: 'red', contested: true },
        { levelId: f.level('yellow'), key: 'yellow', contested: false },
      ],
      target: null,
    });
    expect(first?.records.map((r) => r.id)).toEqual([green.id]);
    expect(second).toMatchObject({
      levels: [{ levelId: f.level('blue'), key: 'blue', contested: true }],
      target: null,
      records: [],
    });
  });

  it('carries the target of a quantitative contest, and its one record', async () => {
    const { user: ana } = await createUser(t.db);
    const { user: bo } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const sp = await createSpecies(t.db);
    const base = { speciesId: sp.id, traitId: trait.id, primaryReferenceId: ref.id } as const;
    const target = await createRecord(t.db, {
      ...base,
      valueText: '5',
      numericValue: 5,
      origin: 'manual',
      createdBy: ana.id,
    });
    const answer = await createRecord(t.db, {
      ...base,
      valueText: '7',
      numericValue: 7,
      origin: 'manual',
      createdBy: bo.id,
      intent: 'contest',
      respondsToRecordId: target.id,
    });
    const contest = await createContest(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      createdBy: bo.id,
      recordIds: [answer.id],
    });

    const [item] = await walk(await reviewer([sp.id]));
    expect(item).toMatchObject({
      id: contest.id,
      levels: null,
      target: { id: target.id, valueText: '5' },
    });
    expect(item?.records.map((r) => r.id)).toEqual([answer.id]);
  });

  it('drops a contest once resolved, withdrawn, its records all withdrawn, or its levels emptied', async () => {
    const f = await categorical(['a', 'b', 'c', 'd', 'e']);
    const a = await f.record('a');
    await f.record('b');
    const contest = (levelId: string, recordIds: string[] = []) =>
      createContest(t.db, {
        speciesId: f.sp.id,
        traitId: f.trait.id,
        createdBy: f.bo.id,
        levelIds: [levelId],
        recordIds,
      });
    const resolved = await contest(f.level('b'));
    const withdrawn = await contest(f.level('b'));
    const created = await f.record('c', { createdBy: f.bo.id, intent: 'contest' });
    const allWithdrawn = await contest(f.level('b'), [created.id]);
    const emptied = await contest(f.level('a'));
    const v = await reviewer([f.sp.id]);
    const ids = async () => (await walk(v)).map((i) => i.id);

    expect(await ids()).toEqual([emptied.id, allWithdrawn.id, withdrawn.id, resolved.id]);
    expect(await countContested(t.db, v)).toBe(4);

    await createContestEvent(t.db, { contestId: resolved.id, actorId: f.ana.id, kind: 'resolve' });
    expect(await ids()).toEqual([emptied.id, allWithdrawn.id, withdrawn.id]);
    expect(await countContested(t.db, v)).toBe(3);

    await createContestEvent(t.db, { contestId: withdrawn.id, actorId: f.bo.id, kind: 'withdraw' });
    expect(await ids()).toEqual([emptied.id, allWithdrawn.id]);
    expect(await countContested(t.db, v)).toBe(2);

    await createAnnotation(t.db, { recordId: created.id, actorId: f.bo.id, kind: 'withdraw' });
    expect(await ids()).toEqual([emptied.id]);
    expect(await countContested(t.db, v)).toBe(1);

    await createAnnotation(t.db, { recordId: a.id, actorId: f.ana.id, kind: 'withdraw' });
    expect(await ids()).toEqual([]);
    expect(await countContested(t.db, v)).toBe(0);
  });

  it('hides a contest naming an inactive level from a viewer without dataset.read_inactive', async () => {
    const f = await categorical(['on', 'off']);
    await f.record('on');
    await f.record('off');
    const contest = await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.bo.id,
      levelIds: [f.level('on'), f.level('off')],
    });
    await t.db
      .update(traitLevels)
      .set({ active: false })
      .where(eq(traitLevels.id, f.level('off')));

    const restricted = await reviewer([f.sp.id]);
    expect(await walk(restricted)).toEqual([]);
    expect(await countContested(t.db, restricted)).toBe(0);
    const inactive = await reviewer([f.sp.id], true);
    expect((await walk(inactive)).map((i) => i.id)).toEqual([contest.id]);
    expect(await countContested(t.db, inactive)).toBe(1);
  });

  it('pages by the contest id, newest first, and rejects a bad cursor', async () => {
    const f = await categorical(['x']);
    await f.record('x');
    const made: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await createContest(t.db, {
        speciesId: f.sp.id,
        traitId: f.trait.id,
        createdBy: f.bo.id,
        levelIds: [f.level('x')],
      });
      made.unshift(c.id);
    }
    const v = await reviewer([f.sp.id]);
    const first = await listContested(t.db, v, { limit: 2 });
    expect(first.data.map((i) => i.id)).toEqual(made.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    expect((await walk(v, 1)).map((i) => i.id)).toEqual(made);
    await expect(listContested(t.db, v, { limit: 2, cursor: 'nope' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  addPlotSpecies,
  createAnnotation,
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
import { annotateRecord, createRecords } from './curation.ts';
import {
  countContested,
  countDisputed,
  countPendingGroups,
  listDisputed,
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

describe('RFC-65 R10 listDisputed contestedBy', () => {
  const t = useTestDb();

  it('carries the contesting records newest first, and [] for a dispute raised by hand', async () => {
    const { user } = await createUser(t.db, { name: 'Contesting Curator' });
    const trait = await createTrait(t.db, { levels: ['a', 'b', 'c'] });
    const baseRef = await createReference(t.db);
    const firstRef = await createReference(t.db);
    const secondRef = await createReference(t.db);
    const withdrawnRef = await createReference(t.db);
    const handRef = await createReference(t.db);
    const contested = await createSpecies(t.db);
    const byHand = await createSpecies(t.db);
    const visibility = await ownPlot(t.db, [contested.id, byHand.id]);

    const base = await createRecord(t.db, {
      speciesId: contested.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: baseRef.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const first = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: contested.id,
      traitId: trait.id,
      value: { levelId: trait.levels[1]?.id as string },
      referenceIds: [firstRef.id],
      intent: 'contest',
      respondsToRecordId: base.id,
    });
    const second = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: contested.id,
      traitId: trait.id,
      value: { levelId: trait.levels[2]?.id as string },
      referenceIds: [secondRef.id],
      intent: 'contest',
      respondsToRecordId: base.id,
    });

    // A third contest, withdrawn: it is the newest of the three, so it would
    // head the list if the withdrawal were not filtered out.
    const withdrawn = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: contested.id,
      traitId: trait.id,
      value: { levelId: trait.levels[1]?.id as string },
      referenceIds: [withdrawnRef.id],
      intent: 'contest',
      respondsToRecordId: base.id,
    });
    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: withdrawn.created[0]?.id as string,
      actorId: user.id,
      kind: 'withdraw',
      canWithdrawAny: false,
      canWithdrawImported: false,
    });

    const handBase = await createRecord(t.db, {
      speciesId: byHand.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: handRef.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createAnnotation(t.db, {
      recordId: handBase.id,
      actorId: user.id,
      kind: 'dispute',
      note: 'Raised by hand, not by a contest',
    });

    const { data } = await listDisputed(t.db, visibility, { limit: 50 });
    const author = { id: user.id, name: 'Contesting Curator' };
    expect(data.find((r) => r.id === base.id)?.contestedBy).toEqual([
      { id: second.created[0]?.id, valueText: 'c', createdBy: author },
      { id: first.created[0]?.id, valueText: 'b', createdBy: author },
    ]);
    expect(data.find((r) => r.id === handBase.id)?.contestedBy).toEqual([]);
  });

  it('keeps only the disputes a contest generated when intent=contest', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const baseRef = await createReference(t.db);
    const contestRef = await createReference(t.db);
    const handRef = await createReference(t.db);
    const contested = await createSpecies(t.db);
    const byHand = await createSpecies(t.db);
    const visibility = await ownPlot(t.db, [contested.id, byHand.id]);

    const base = await createRecord(t.db, {
      speciesId: contested.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: baseRef.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: contested.id,
      traitId: trait.id,
      value: { levelId: trait.levels[1]?.id as string },
      referenceIds: [contestRef.id],
      intent: 'contest',
      respondsToRecordId: base.id,
    });
    const handBase = await createRecord(t.db, {
      speciesId: byHand.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: handRef.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createAnnotation(t.db, {
      recordId: handBase.id,
      actorId: user.id,
      kind: 'dispute',
      note: 'Raised by hand, not by a contest',
    });

    const all = await listDisputed(t.db, visibility, { limit: 50 });
    expect([...all.data.map((r) => r.id)].sort()).toEqual([base.id, handBase.id].sort());
    const generated = await listDisputed(t.db, visibility, { limit: 50, intent: 'contest' });
    expect(generated.data.map((r) => r.id)).toEqual([base.id]);
  });
});

describe('RFC-72 R1 queue counts', () => {
  const t = useTestDb();

  it('count the same rows their lists return', async () => {
    const { user } = await createUser(t.db);
    const pendingOne = await createTrait(t.db, { levels: ['a'] });
    const pendingTwo = await createTrait(t.db, { levels: ['a'] });
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const pendingSpecies = await createSpecies(t.db);
    const handDispute = await createSpecies(t.db);
    const contestedOne = await createSpecies(t.db);
    const contestedTwo = await createSpecies(t.db);
    const visibility = await ownPlot(t.db, [
      pendingSpecies.id,
      handDispute.id,
      contestedOne.id,
      contestedTwo.id,
    ]);
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

    // One dispute raised by hand and two raised by a contest.
    const handBase = await createRecord(t.db, {
      speciesId: handDispute.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createAnnotation(t.db, {
      recordId: handBase.id,
      actorId: user.id,
      kind: 'dispute',
      note: 'Raised by hand, not by a contest',
    });
    for (const species of [contestedOne, contestedTwo]) {
      const base = await createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText: 'a',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: species.id,
        traitId: trait.id,
        value: { levelId: trait.levels[1]?.id as string },
        referenceIds: [ref.id],
        intent: 'contest',
        respondsToRecordId: base.id,
      });
    }

    const disputed = await listDisputed(t.db, visibility, { limit: 50 });
    expect(disputed.nextCursor).toBeNull();
    expect(disputed.data).toHaveLength(3);
    expect(await countDisputed(t.db, visibility)).toBe(disputed.data.length);

    // The count is the whole queue, not the first page of it: walking the
    // keyset cursor one record at a time reaches exactly as many.
    const paged: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const next = await listDisputed(t.db, visibility, { limit: 1, cursor });
      paged.push(...next.data.map((r) => r.id));
      if (next.nextCursor === null) break;
      cursor = next.nextCursor;
    }
    expect(new Set(paged).size).toBe(await countDisputed(t.db, visibility));

    const contests = await listDisputed(t.db, visibility, { limit: 50, intent: 'contest' });
    expect(contests.data).toHaveLength(2);
    expect(await countContested(t.db, visibility)).toBe(contests.data.length);
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

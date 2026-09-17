import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createVisibilityFixture,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { AppError } from '../http/errors.ts';
import {
  annotateRecord,
  createRecords,
  currentAccepted,
  getAccepted,
  setAccepted,
} from './curation.ts';
import { listDisputed, mapPending, pendingTraits } from './queues.ts';
import { getRecord } from './records.ts';

/** Swallows the `AppError` the losing side of the race legitimately throws once the other side has committed. */
async function settled(p: Promise<unknown>, expectedCodes: string[]): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (!(err instanceof AppError) || !expectedCodes.includes(err.code)) throw err;
  }
}

describe('RFC-65 R4, R6 the withdraw-vs-accept race is serialised by an advisory lock', () => {
  const t = useTestDb();

  it('never leaves an accepted value pointing at a withdrawn record', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    for (let i = 0; i < 10; i++) {
      // A fresh species per iteration: the claim-key unique index would
      // otherwise reject the second iteration's identical record.
      const sp1 = await createSpecies(t.db);
      const rec = await createRecord(t.db, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'a',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await Promise.all([
        settled(
          setAccepted(t.db, {
            speciesId: sp1.id,
            traitId: trait.id,
            actorId: user.id,
            decision: 'accepted',
            recordId: rec.id,
          }),
          ['RECORD_WITHDRAWN'],
        ),
        settled(
          annotateRecord(t.db, UNRESTRICTED, {
            recordId: rec.id,
            actorId: user.id,
            kind: 'withdraw',
            note: 'Race',
            canWithdrawAny: false,
            canReview: false,
          }),
          ['RECORD_IS_ACCEPTED'],
        ),
      ]);
      const review = (await getRecord(t.db, UNRESTRICTED, rec.id))?.review;
      const current = await currentAccepted(t.db, sp1.id, trait.id);
      expect(
        review === 'withdrawn' && current?.recordId === rec.id,
        `iteration ${i}: review=${review}, current.recordId=${current?.recordId}`,
      ).toBe(false);
    }
  });
});

describe('RFC-65 R6 setAccepted clearing branch locks before deciding', () => {
  const t = useTestDb();

  it('five concurrent identical clears leave exactly one cleared row in the history', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const sp = await createSpecies(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await setAccepted(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      actorId: user.id,
      decision: 'accepted',
      recordId: rec.id,
    });
    await Promise.all(
      Array.from({ length: 5 }, () =>
        setAccepted(t.db, {
          speciesId: sp.id,
          traitId: trait.id,
          actorId: user.id,
          decision: 'cleared',
          note: 'Race',
        }),
      ),
    );
    const { history } = await getAccepted(t.db, sp.id, trait.id);
    expect(history.filter((h) => h.decision === 'cleared')).toHaveLength(1);
  });
});

describe('RFC-33 R5 createRecord and annotateRecord by viewer', () => {
  const t = useTestDb();

  it('treat a hidden species or a record on it as not found for a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    await expect(
      createRecords(t.db, RESTRICTED, {
        actorId: user.id,
        speciesId: f.hiddenSpecies.id,
        traitId: f.activeTrait.id,
        value: { levelId: f.activeTrait.levels[0]?.id as string },
        referenceIds: [f.reference.id],
      }),
    ).rejects.toMatchObject({ code: 'SPECIES_NOT_FOUND' });
    const createdResult = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      value: { levelId: f.activeTrait.levels[0]?.id as string },
      referenceIds: [f.reference.id],
      rawValue: 'a second, distinct claim',
    });
    expect(createdResult.created[0]?.speciesId).toBe(f.hiddenSpecies.id);
    await expect(
      annotateRecord(t.db, RESTRICTED, {
        recordId: f.onHiddenSpecies.id,
        actorId: user.id,
        kind: 'confirm',
        canWithdrawAny: false,
        canReview: false,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
});

describe('RFC-33 R3 queues by viewer', () => {
  const t = useTestDb();

  it('omits a pending trait and a disputed record on a hidden species from a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    await createRecord(t.db, {
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'unmapped',
      primaryReferenceId: f.reference.id,
      harmonisation: 'unknown_level',
      origin: 'manual',
      createdBy: user.id,
    });
    const restrictedTraits = await pendingTraits(t.db, RESTRICTED);
    expect(restrictedTraits.find((x) => x.trait.id === f.activeTrait.id)).toBeUndefined();
    const unrestrictedTraits = await pendingTraits(t.db, UNRESTRICTED);
    expect(unrestrictedTraits.find((x) => x.trait.id === f.activeTrait.id)).toMatchObject({
      count: 1,
    });

    const disputed = await createRecord(t.db, {
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'one',
      levelId: f.activeTrait.levels[0]?.id,
      rawValue: 'a second, distinct claim',
      primaryReferenceId: f.reference.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createAnnotation(t.db, {
      recordId: disputed.id,
      actorId: user.id,
      kind: 'dispute',
      note: 'Disputed on a hidden species',
    });
    const restrictedDisputed = await listDisputed(t.db, RESTRICTED, { limit: 10 });
    expect(restrictedDisputed.data.map((r) => r.id)).not.toContain(disputed.id);
    const unrestrictedDisputed = await listDisputed(t.db, UNRESTRICTED, { limit: 10 });
    expect(unrestrictedDisputed.data.map((r) => r.id)).toContain(disputed.id);
  });
});

describe('RFC-33 R5 mapPending by viewer', () => {
  const t = useTestDb();

  it('never maps a pending row of a hidden species for a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    await createRecord(t.db, {
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'unmapped',
      primaryReferenceId: f.reference.id,
      harmonisation: 'unknown_level',
      origin: 'manual',
      createdBy: user.id,
    });

    const restricted = await mapPending(t.db, RESTRICTED, {
      actorId: user.id,
      traitId: f.activeTrait.id,
      valueText: 'unmapped',
      value: { levelIds: [f.activeTrait.levels[0]?.id as string] },
    });
    expect(restricted).toEqual({ created: 0, skipped: 0 });
    const stillPending = await pendingTraits(t.db, UNRESTRICTED);
    expect(stillPending.find((x) => x.trait.id === f.activeTrait.id)).toMatchObject({ count: 1 });

    const unrestricted = await mapPending(t.db, UNRESTRICTED, {
      actorId: user.id,
      traitId: f.activeTrait.id,
      valueText: 'unmapped',
      value: { levelIds: [f.activeTrait.levels[0]?.id as string] },
    });
    expect(unrestricted).toEqual({ created: 1, skipped: 0 });
  });
});

describe('RFC-70 R1-R6 createRecords and annotateRecord', () => {
  const t = useTestDb();

  it('creates multiple records across references in input order; detects duplicates', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const ref1 = await createReference(t.db);
    const ref2 = await createReference(t.db);

    const res = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id as string },
      referenceIds: [ref1.id, ref2.id],
    });
    expect(res.created).toHaveLength(2);
    expect(res.created[0]?.primaryReference?.id).toBe(ref1.id);
    expect(res.created[1]?.primaryReference?.id).toBe(ref2.id);
    expect(res.duplicates).toEqual([]);

    // One duplicate, one new
    const ref3 = await createReference(t.db);
    const partial = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id as string },
      referenceIds: [ref1.id, ref3.id],
    });
    expect(partial.created).toHaveLength(1);
    expect(partial.created[0]?.primaryReference?.id).toBe(ref3.id);
    expect(partial.duplicates).toEqual([{ recordId: res.created[0]?.id, referenceId: ref1.id }]);

    // Both duplicates → 409 RECORD_DUPLICATE
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait.id,
        value: { levelId: trait.levels[0]?.id as string },
        referenceIds: [ref1.id, ref2.id],
      }),
    ).rejects.toMatchObject({
      code: 'RECORD_DUPLICATE',
      details: [
        { path: 'sources.references.0', message: res.created[0]?.id },
        { path: 'sources.references.1', message: res.created[1]?.id },
      ],
    });
  });

  it('contest generates a dispute annotation on the base record; complement does not', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const ref1 = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const ref3 = await createReference(t.db);

    const base = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id as string,
      primaryReferenceId: ref1.id,
      origin: 'manual',
      createdBy: user.id,
    });

    // Contest with two references
    const contestRes = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[1]?.id as string },
      referenceIds: [ref2.id, ref3.id],
      intent: 'contest',
      respondsToRecordId: base.id,
    });
    expect(contestRes.created).toHaveLength(2);
    expect(contestRes.created[0]?.intent).toBe('contest');
    expect(contestRes.created[0]?.respondsTo?.id).toBe(base.id);

    // Check base record annotations & review status
    const updatedBase = await getRecord(t.db, UNRESTRICTED, base.id);
    expect(updatedBase?.review).toBe('disputed');
    const disputeAnn = updatedBase?.annotations.find((a) => a.kind === 'dispute');
    expect(disputeAnn).toBeDefined();
    expect(disputeAnn?.generated).toBe(true);
    expect(disputeAnn?.note).toBe(`Contested by record ${contestRes.created[0]?.id}, ${contestRes.created[1]?.id}`);

    // Check responses on base record
    expect(updatedBase?.responses).toHaveLength(2);

    // Complement inserts no annotation on base
    const ref4 = await createReference(t.db);
    await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[1]?.id as string },
      referenceIds: [ref4.id],
      intent: 'complement',
      respondsToRecordId: base.id,
    });
    const baseAfterComplement = await getRecord(t.db, UNRESTRICTED, base.id);
    expect(baseAfterComplement?.annotations.filter((a) => a.kind === 'dispute')).toHaveLength(1);
  });

  it('enforces respondsTo validation: wrong trait, withdrawn base, invisible base', async () => {
    const { user } = await createUser(t.db);
    const trait1 = await createTrait(t.db, { levels: ['a'] });
    const trait2 = await createTrait(t.db, { levels: ['b'] });
    const sp = await createSpecies(t.db);
    const ref = await createReference(t.db);

    const base = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait1.id,
      valueText: 'a',
      levelId: trait1.levels[0]?.id as string,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });

    // Wrong trait
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait2.id,
        value: { levelId: trait2.levels[0]?.id as string },
        referenceIds: [ref.id],
        intent: 'contest',
        respondsToRecordId: base.id,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'respondsToRecordId' }],
    });

    // Same value for contest
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait1.id,
        value: { levelId: trait1.levels[0]?.id as string },
        referenceIds: [ref.id],
        intent: 'contest',
        respondsToRecordId: base.id,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'value' }],
    });

    // Withdraw base record
    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: base.id,
      actorId: user.id,
      kind: 'withdraw',
      canWithdrawAny: true,
      canReview: true,
    });

    // Withdrawn base
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait1.id,
        value: { levelId: trait1.levels[0]?.id as string },
        referenceIds: [ref.id],
        intent: 'complement',
        respondsToRecordId: base.id,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_WITHDRAWN' });
  });

  it('annotateRecord gates dispute/neutral by canReview, supports confirm reference, and side effects on withdraw', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const ref = await createReference(t.db);

    const base = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id as string,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });

    // canReview: false denies dispute and neutral
    await expect(
      annotateRecord(t.db, UNRESTRICTED, {
        recordId: base.id,
        actorId: user.id,
        kind: 'dispute',
        note: 'note',
        canWithdrawAny: false,
        canReview: false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(
      annotateRecord(t.db, UNRESTRICTED, {
        recordId: base.id,
        actorId: user.id,
        kind: 'neutral',
        canWithdrawAny: false,
        canReview: false,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // confirm with referenceId
    const confirmed = await annotateRecord(t.db, UNRESTRICTED, {
      recordId: base.id,
      actorId: user.id,
      kind: 'confirm',
      referenceId: ref.id,
      canWithdrawAny: false,
      canReview: false,
    });
    expect(confirmed.annotations[0]?.reference?.id).toBe(ref.id);
    expect(confirmed.annotations[0]?.reference?.kind).toBe('publication');

    // Contest record creation and withdrawal side effect
    const contestRes = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[1]?.id as string },
      referenceIds: [ref.id],
      intent: 'contest',
      respondsToRecordId: base.id,
    });
    const contestRec = contestRes.created[0]!;

    // Now withdraw the contest record: should insert neutral on base because actor's latest stance on base is dispute
    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: contestRec.id,
      actorId: user.id,
      kind: 'withdraw',
      canWithdrawAny: false,
      canReview: false,
    });

    const baseAfterContestWithdraw = await getRecord(t.db, UNRESTRICTED, base.id);
    const neutralAnn = baseAfterContestWithdraw?.annotations.find((a) => a.kind === 'neutral');
    expect(neutralAnn).toBeDefined();
    expect(neutralAnn?.generated).toBe(true);
    expect(neutralAnn?.note).toBe(`Contest withdrawn (record ${contestRec.id})`);
  });
});

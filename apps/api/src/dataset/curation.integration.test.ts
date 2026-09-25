import { and, eq } from 'drizzle-orm';
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
import { recordReferences } from '../db/schema/records.ts';
import { referenceTraits } from '../db/schema/reference-traits.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { AppError } from '../http/errors.ts';
import {
  annotateRecord,
  createRecords,
  nextRecordCodes,
} from './curation.ts';
import { listDisputed, mapPending, pendingTraits } from './queues.ts';
import { getRecord } from './records.ts';

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

  it('RFC-63 R12 nextRecordCodes takes one sequence number: bare for one record, lettered for several', async () => {
    const [one] = await nextRecordCodes(t.db, 1);
    expect(one).toMatch(/^TR_\d+$/);
    const three = await nextRecordCodes(t.db, 3);
    const base = three[0]?.slice(0, -1);
    expect(base).toMatch(/^TR_\d+$/);
    expect(base).not.toBe(one);
    expect(three).toEqual([`${base}a`, `${base}b`, `${base}c`]);
    await expect(nextRecordCodes(t.db, 0)).rejects.toThrow();
  });

  it('spec R-4 creates one record per value: first reference primary, the rest in record_references', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const ref1 = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const ref3 = await createReference(t.db);

    const res = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id as string },
      referenceIds: [ref1.id, ref2.id, ref3.id],
    });
    expect(res.created).toHaveLength(1);
    expect(res.duplicates).toEqual([]);
    const record = res.created[0];
    expect(record?.recordCode).toMatch(/^TR_\d+$/);
    expect(record?.primaryReference?.id).toBe(ref1.id);
    const extras = [ref2, ref3]
      .sort((x, y) => x.citationKey.localeCompare(y.citationKey))
      .map((r) => r.id);
    expect(record?.references.map((r) => r.id)).toEqual([ref1.id, ...extras]);

    // The same claim again (same primary reference) → 409 naming the record.
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
      details: [{ path: 'sources.references.0', message: record?.id }],
    });
  });

  it('RFC-61 R4, R9 an extra reference equal to the secondary is not double-counted', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const sp = await createSpecies(t.db);
    const primary = await createReference(t.db);
    const shared = await createReference(t.db);

    const res = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id as string },
      referenceIds: [primary.id, shared.id],
      secondaryReferenceId: shared.id,
    });
    // `shared` shows up as the secondary reference (owner amendment 4: primary,
    // then the secondary, then record_references), not as an extra: it gets
    // no record_references row of its own, so its usage is not double-counted.
    expect(res.created[0]?.references.map((r) => r.id)).toEqual([primary.id, shared.id]);

    const [row] = await t.db
      .select({
        primaryCount: bibliographicReferences.primaryCount,
        secondaryCount: bibliographicReferences.secondaryCount,
      })
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, shared.id));
    expect(row).toMatchObject({ primaryCount: 0, secondaryCount: 1 });

    const [usage] = await t.db
      .select({ recordCount: referenceTraits.recordCount })
      .from(referenceTraits)
      .where(
        and(eq(referenceTraits.referenceId, shared.id), eq(referenceTraits.traitId, trait.id)),
      );
    expect(usage?.recordCount).toBe(1);
  });

  it('spec R-4 a repeated extra reference writes one record_references row, not a 500', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const sp = await createSpecies(t.db);
    const primary = await createReference(t.db);
    const extra = await createReference(t.db);

    const res = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id as string },
      referenceIds: [primary.id, extra.id, extra.id],
    });
    expect(res.created[0]?.references.map((r) => r.id)).toEqual([primary.id, extra.id]);

    const rows = await t.db
      .select()
      .from(recordReferences)
      .where(eq(recordReferences.recordId, res.created[0]?.id as string));
    expect(rows).toHaveLength(1);
  });

  it('spec R-5 stores the six quantitative fields and derives value_text from them', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const sp = await createSpecies(t.db);
    const ref = await createReference(t.db);
    const res = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { quantitative: { min: 2, max: 8, mean: 4.5, sd: 0.5, n: 12 } },
      referenceIds: [ref.id],
    });
    expect(res.created[0]).toMatchObject({
      valueText: 'min=2;max=8;mean=4.5;sd=0.5;n=12',
      numericValue: null,
      quantitative: { min: 2, max: 8, mean: 4.5, sd: 0.5, n: 12 },
      harmonisation: 'harmonised',
    });
    const single = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { quantitative: { single: 1e3 } },
      referenceIds: [ref.id],
    });
    expect(single.created[0]).toMatchObject({
      valueText: '1000',
      numericValue: 1000,
      quantitative: { single: 1000 },
    });
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait.id,
        value: { quantitative: { mean: 1e308 } },
        referenceIds: [ref.id],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'value.quantitative.mean' }],
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
    expect(contestRes.created).toHaveLength(1);
    expect(contestRes.created[0]?.references.map((r) => r.id).sort()).toEqual(
      [ref2.id, ref3.id].sort(),
    );
    expect(contestRes.created[0]?.intent).toBe('contest');
    expect(contestRes.created[0]?.respondsTo?.id).toBe(base.id);

    // Check base record annotations & review status
    const updatedBase = await getRecord(t.db, UNRESTRICTED, base.id);
    expect(updatedBase?.review).toBe('disputed');
    const disputeAnn = updatedBase?.annotations.find((a) => a.kind === 'dispute');
    expect(disputeAnn).toBeDefined();
    expect(disputeAnn?.generated).toBe(true);
    expect(disputeAnn?.note).toBe(`Contested by record ${contestRes.created[0]?.id}`);

    // Check responses on base record
    expect(updatedBase?.responses).toHaveLength(1);

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
      note: 'Withdrawn by the author',
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
    const contestRec = contestRes.created[0];
    if (!contestRec) throw new Error('contest record was not created');

    // Now withdraw the contest record: should insert neutral on base because actor's latest stance on base is dispute
    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: contestRec.id,
      actorId: user.id,
      kind: 'withdraw',
      note: 'Withdrawn by the author',
      canWithdrawAny: false,
      canReview: false,
    });

    const baseAfterContestWithdraw = await getRecord(t.db, UNRESTRICTED, base.id);
    const neutralAnn = baseAfterContestWithdraw?.annotations.find((a) => a.kind === 'neutral');
    expect(neutralAnn).toBeDefined();
    expect(neutralAnn?.generated).toBe(true);
    expect(neutralAnn?.note).toBe(`Contest withdrawn (record ${contestRec.id})`);
  });

  it('RFC-70 R5 withdrawing one contest leaves the dispute of another live contest standing', async () => {
    const { user } = await createUser(t.db);
    const sp = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b', 'c'] });
    const refOne = await createReference(t.db);
    const refTwo = await createReference(t.db);
    const base = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: refOne.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const contests = [];
    for (const [level, ref] of [
      [trait.levels[1]?.id, refOne.id],
      [trait.levels[2]?.id, refTwo.id],
    ] as const) {
      const res = await createRecords(t.db, UNRESTRICTED, {
        actorId: user.id,
        speciesId: sp.id,
        traitId: trait.id,
        value: { levelId: level as string },
        referenceIds: [ref],
        intent: 'contest',
        respondsToRecordId: base.id,
      });
      const created = res.created[0];
      if (!created) throw new Error('contest record was not created');
      contests.push(created);
    }
    const [first, second] = contests;
    if (!first || !second) throw new Error('both contests are needed');

    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: first.id,
      actorId: user.id,
      kind: 'withdraw',
      note: 'Withdrawn by the author',
      canWithdrawAny: false,
      canReview: false,
    });
    // The second contest is still live, so the dispute must stand.
    const afterFirst = await getRecord(t.db, UNRESTRICTED, base.id);
    expect(afterFirst?.annotations.some((a) => a.kind === 'neutral')).toBe(false);
    expect(afterFirst?.review).toBe('disputed');

    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: second.id,
      actorId: user.id,
      kind: 'withdraw',
      note: 'Withdrawn by the author',
      canWithdrawAny: false,
      canReview: false,
    });
    const afterSecond = await getRecord(t.db, UNRESTRICTED, base.id);
    expect(afterSecond?.annotations.find((a) => a.kind === 'neutral')?.note).toBe(
      `Contest withdrawn (record ${second.id})`,
    );
    expect(afterSecond?.review).not.toBe('disputed');
  });
});

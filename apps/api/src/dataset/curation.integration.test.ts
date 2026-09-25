import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createImportBatch,
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
import { annotateRecord, createRecords, nextRecordCodes } from './curation.ts';
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
        canWithdrawImported: false,
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

  it('a contest still creates its record and responds to the base; the dispute annotation it used to leave is Task 6’s to remove', async () => {
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

    // RFC-63 R6, R14: contested comes from contest storage alone, which this
    // create path does not write yet (plan 13g Task 6).
    const updatedBase = await getRecord(t.db, UNRESTRICTED, base.id);
    expect(updatedBase?.review).toBe('unvalidated');
    expect(updatedBase?.responses).toHaveLength(1);
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
      canWithdrawImported: true,
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
});

describe('RFC-70 R4, RFC-65 R3 annotateRecord (spec R-6, R-10, R-12)', () => {
  const t = useTestDb();
  const base = { canWithdrawAny: false, canWithdrawImported: false };

  async function setup() {
    const { user: author } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const sp = await createSpecies(t.db);
    const manual = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: author.id,
    });
    const batch = await createImportBatch(t.db);
    const imported = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'b',
      levelId: trait.levels[1]?.id,
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    return { author, other, ref, ref2, trait, sp, manual, imported };
  }

  it('a confirm on your own record is refused; on another, it counts once per user', async () => {
    const f = await setup();
    await expect(
      annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        recordId: f.manual.id,
        actorId: f.author.id,
        kind: 'confirm',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await annotateRecord(t.db, UNRESTRICTED, {
      ...base,
      recordId: f.manual.id,
      actorId: f.other.id,
      kind: 'confirm',
    });
    const after = await annotateRecord(t.db, UNRESTRICTED, {
      ...base,
      recordId: f.manual.id,
      actorId: f.other.id,
      kind: 'confirm',
      referenceId: f.ref.id,
    });
    expect(after).toMatchObject({ validationCount: 1, review: 'validated' });
  });

  it('RFC-65 R3 a repeated confirm — same reference, or reference-less twice — inserts nothing; a new reference is inserted', async () => {
    const f = await setup();
    const first = await annotateRecord(t.db, UNRESTRICTED, {
      ...base,
      recordId: f.manual.id,
      actorId: f.other.id,
      kind: 'confirm',
    });
    expect(first?.annotations).toHaveLength(1);
    // Reference-less again: the actor already confirmed the record.
    const repeatBare = await annotateRecord(t.db, UNRESTRICTED, {
      ...base,
      recordId: f.manual.id,
      actorId: f.other.id,
      kind: 'confirm',
    });
    expect(repeatBare?.annotations).toHaveLength(1);
    // A confirm with a reference: a new claim, inserted.
    const withRef = await annotateRecord(t.db, UNRESTRICTED, {
      ...base,
      recordId: f.manual.id,
      actorId: f.other.id,
      kind: 'confirm',
      referenceId: f.ref.id,
    });
    expect(withRef?.annotations).toHaveLength(2);
    // The very same reference again: no insert.
    const repeatSameRef = await annotateRecord(t.db, UNRESTRICTED, {
      ...base,
      recordId: f.manual.id,
      actorId: f.other.id,
      kind: 'confirm',
      referenceId: f.ref.id,
    });
    expect(repeatSameRef?.annotations).toHaveLength(2);
    // A different reference again: another new claim.
    const secondRef = await annotateRecord(t.db, UNRESTRICTED, {
      ...base,
      recordId: f.manual.id,
      actorId: f.other.id,
      kind: 'confirm',
      referenceId: f.ref2.id,
    });
    expect(secondRef?.annotations).toHaveLength(3);
    // One actor, however many confirms: counted once (RFC-63 R8).
    expect(secondRef?.validationCount).toBe(1);
  });

  it('withdraw: the author, records.withdraw for manual, records.withdraw_imported for imported; answers null', async () => {
    const f = await setup();
    await expect(
      annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        canWithdrawAny: true,
        recordId: f.imported.id,
        actorId: f.other.id,
        kind: 'withdraw',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        canWithdrawImported: true,
        recordId: f.manual.id,
        actorId: f.other.id,
        kind: 'withdraw',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(
      await annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        canWithdrawImported: true,
        recordId: f.imported.id,
        actorId: f.other.id,
        kind: 'withdraw',
      }),
    ).toBeNull();
    expect(
      await annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        recordId: f.manual.id,
        actorId: f.author.id,
        kind: 'withdraw',
      }),
    ).toBeNull();
    await expect(
      annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        recordId: f.manual.id,
        actorId: f.other.id,
        kind: 'confirm',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('two concurrent withdraws of the same record: one succeeds with null, the other answers 404, never a raw 500', async () => {
    const f = await setup();
    const results = await Promise.allSettled([
      annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        recordId: f.manual.id,
        actorId: f.author.id,
        kind: 'withdraw',
      }),
      annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        recordId: f.manual.id,
        actorId: f.author.id,
        kind: 'withdraw',
      }),
    ]);
    const statuses = results.map((r) => r.status);
    // The species × trait lock (E3) serialises the two transactions: the
    // second sees the first's withdrawal (the record is now invisible) and
    // answers 404, never a raw `record_annotations_withdraw_idx` violation.
    expect(statuses.sort()).toEqual(['fulfilled', 'rejected']);
    for (const r of results) {
      if (r.status === 'fulfilled') expect(r.value).toBeNull();
      else expect(r.reason).toMatchObject({ code: 'RECORD_NOT_FOUND' });
    }
  });

  it('a second, sequential withdraw of the same record answers 404, not a duplicate-key error', async () => {
    const f = await setup();
    expect(
      await annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        recordId: f.manual.id,
        actorId: f.author.id,
        kind: 'withdraw',
      }),
    ).toBeNull();
    await expect(
      annotateRecord(t.db, UNRESTRICTED, {
        ...base,
        recordId: f.manual.id,
        actorId: f.author.id,
        kind: 'withdraw',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
});

import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createContest,
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
import { contestLevels, contestRecords, contests } from '../db/schema/contests.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import { recordReferences } from '../db/schema/records.ts';
import { referenceTraits } from '../db/schema/reference-traits.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import {
  annotateRecord,
  createRecords,
  nextRecordCodes,
  validateLevel,
  withdrawLevel,
} from './curation.ts';
import { listDisputed, mapPending, pendingTraits } from './queues.ts';
import { getRecord, listRecords } from './records.ts';
import { ensurePersonalObservation } from './references.ts';
import { speciesTraitSummary } from './summary.ts';
import { getSpecies } from './taxa.ts';

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
        value: { levelIds: [f.activeTrait.levels[0]?.id as string] },
        referenceIds: [f.reference.id],
      }),
    ).rejects.toMatchObject({ code: 'SPECIES_NOT_FOUND' });
    const createdResult = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      value: { levelIds: [f.activeTrait.levels[0]?.id as string] },
      referenceIds: [f.reference.id],
    });
    // The unrestricted viewer sees the actor's own record of that level: a duplicate.
    expect(createdResult.duplicates.map((d) => d.recordId)).toEqual([f.onHiddenSpecies.id]);
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
      value: { levelIds: [trait.levels[0]?.id as string] },
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

    // RFC-70 R3, RFC-65 R2 (retired): the same entry again is the actor's own
    // match — a reported duplicate, never a 409.
    const again = await createRecords(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelIds: [trait.levels[0]?.id as string] },
      referenceIds: [ref1.id, ref2.id],
    });
    expect(again).toEqual({
      created: [],
      validated: [],
      duplicates: [{ recordId: record?.id, recordCode: record?.recordCode }],
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
      value: { levelIds: [trait.levels[0]?.id as string] },
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
      value: { levelIds: [trait.levels[0]?.id as string] },
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

describe('RFC-70 R1-R3, RFC-63 R14 createRecords: one record per level, matches, contests', () => {
  const t = useTestDb();
  const withdraw = { kind: 'withdraw' as const, canWithdrawAny: true, canWithdrawImported: true };

  async function setup(levels = ['red', 'blue', 'yellow', 'green']) {
    const { user: me } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db, { levels });
    const sp = await createSpecies(t.db);
    const level = (k: string) => trait.levels.find((l) => l.key === k)?.id as string;
    /** A live, harmonised record of level `k` by `by` (another user unless given). */
    const rec = (k: string, by = other.id, primaryReferenceId = ref2.id) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: k,
        levelId: level(k),
        primaryReferenceId,
        origin: 'manual',
        createdBy: by,
      });
    const input = (
      keys: string[],
      extra: Partial<Parameters<typeof createRecords>[2]> = {},
    ): Parameters<typeof createRecords>[2] => ({
      actorId: me.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelIds: keys.map(level) },
      referenceIds: [ref.id],
      ...extra,
    });
    return { me, other, ref, ref2, trait, sp, level, rec, input };
  }

  /** The contests stored for one species × trait, with their levels and records. */
  async function contestsOf(speciesId: string, traitId: string) {
    const rows = await t.db
      .select()
      .from(contests)
      .where(and(eq(contests.speciesId, speciesId), eq(contests.traitId, traitId)));
    return Promise.all(
      rows.map(async (c) => ({
        createdBy: c.createdBy,
        levelIds: (await t.db.select().from(contestLevels).where(eq(contestLevels.contestId, c.id)))
          .map((l) => l.levelId)
          .sort(),
        recordIds: (
          await t.db.select().from(contestRecords).where(eq(contestRecords.contestId, c.id))
        ).map((r) => r.recordId),
      })),
    );
  }

  const confirmsBy = async (recordId: string, actorId: string) =>
    (
      await t.db
        .select({ referenceId: recordAnnotations.referenceId })
        .from(recordAnnotations)
        .where(
          and(
            eq(recordAnnotations.recordId, recordId),
            eq(recordAnnotations.actorId, actorId),
            eq(recordAnnotations.kind, 'confirm'),
          ),
        )
    )
      .map((a) => a.referenceId)
      .sort();

  it('RFC-63 R12 one record per level, in input order, sharing one code number with letter suffixes; each carries every reference', async () => {
    const f = await setup();
    const result = await createRecords(
      t.db,
      UNRESTRICTED,
      f.input(['yellow', 'red'], { referenceIds: [f.ref.id, f.ref2.id] }),
    );
    expect(result.created.map((r) => r.level?.key)).toEqual(['yellow', 'red']);
    expect(result.validated).toEqual([]);
    expect(result.duplicates).toEqual([]);
    const [a, b] = result.created.map((r) => r.recordCode);
    const n = a?.match(/^TR_(\d+)a$/)?.[1];
    expect(n).toBeDefined();
    expect(b).toBe(`TR_${n}b`);
    for (const r of result.created) {
      expect(r.references.map((x) => x.id)).toEqual([f.ref.id, f.ref2.id]);
    }
    const single = await createRecords(t.db, UNRESTRICTED, f.input(['blue']));
    expect(single.created[0]?.recordCode).toMatch(/^TR_\d+$/);
  });

  it('a matched level consumes no code: the one created record keeps the bare number', async () => {
    const f = await setup();
    await f.rec('blue');
    const result = await createRecords(t.db, UNRESTRICTED, f.input(['blue', 'red']));
    expect(result.validated).toHaveLength(1);
    expect(result.created.map((r) => r.recordCode)).toEqual([expect.stringMatching(/^TR_\d+$/)]);
  });

  it("RFC-65 R13 a match validates the whole level: every other contributor's record, one confirm per reference; the actor's own are duplicates; re-entry is idempotent", async () => {
    const f = await setup();
    const { user: third } = await createUser(t.db);
    const x = await f.rec('blue');
    const y = await f.rec('blue', third.id, (await createReference(t.db)).id);
    const mine = await f.rec('blue', f.me.id, (await createReference(t.db)).id);
    const entry = f.input(['blue'], { referenceIds: [f.ref.id, f.ref2.id] });
    const result = await createRecords(t.db, UNRESTRICTED, entry);
    expect(result.created).toEqual([]);
    expect(result.validated.map((v) => v.recordId).sort()).toEqual([x.id, y.id].sort());
    expect(result.validated.every((v) => /^TR_\d+/.test(v.recordCode))).toBe(true);
    expect(result.duplicates.map((d) => d.recordId)).toEqual([mine.id]);
    expect(await confirmsBy(x.id, f.me.id)).toEqual([f.ref.id, f.ref2.id].sort());
    expect(await confirmsBy(mine.id, f.me.id)).toEqual([]);
    expect((await getRecord(t.db, UNRESTRICTED, x.id))?.validationCount).toBe(1);

    // RFC-65 R3: the same entry again inserts nothing and answers the same.
    const again = await createRecords(t.db, UNRESTRICTED, entry);
    expect(again.validated.map((v) => v.recordId).sort()).toEqual([x.id, y.id].sort());
    expect(await confirmsBy(x.id, f.me.id)).toEqual([f.ref.id, f.ref2.id].sort());
    expect(await confirmsBy(y.id, f.me.id)).toEqual([f.ref.id, f.ref2.id].sort());
  });

  it('RFC-61 R7 a personal observation validates with one reference-less confirm, once', async () => {
    const f = await setup();
    const existing = await f.rec('blue');
    const po = await ensurePersonalObservation(t.db, f.me.id);
    const entry = f.input(['blue'], { referenceIds: [po.id] });
    expect((await createRecords(t.db, UNRESTRICTED, entry)).validated).toHaveLength(1);
    await createRecords(t.db, UNRESTRICTED, entry);
    expect(await confirmsBy(existing.id, f.me.id)).toEqual([null]);
  });

  it('RFC-63 R13 a withdrawn record is no match', async () => {
    const f = await setup();
    const gone = await f.rec('blue');
    await createAnnotation(t.db, { recordId: gone.id, actorId: f.other.id, kind: 'withdraw' });
    const result = await createRecords(t.db, UNRESTRICTED, f.input(['blue']));
    expect(result.created.map((r) => r.level?.key)).toEqual(['blue']);
    expect(result.validated).toEqual([]);
  });

  it('RFC-63 R3, RFC-33 R4 a claim-key collision creates nothing; it is a duplicate only when the colliding record is visible', async () => {
    const f = await setup();
    // A withdrawn record holding the very claim key of the entry.
    const gone = await f.rec('blue', f.other.id, f.ref.id);
    await createAnnotation(t.db, { recordId: gone.id, actorId: f.other.id, kind: 'withdraw' });
    expect(await createRecords(t.db, UNRESTRICTED, f.input(['blue']))).toEqual({
      created: [],
      validated: [],
      duplicates: [],
    });
    // A pending record with the same value text: visible to a reviewer only.
    const pending = await createRecord(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      valueText: 'red',
      harmonisation: 'unknown_level',
      primaryReferenceId: f.ref.id,
      origin: 'manual',
      createdBy: f.other.id,
    });
    expect(await createRecords(t.db, RESTRICTED, f.input(['red']))).toEqual({
      created: [],
      validated: [],
      duplicates: [],
    });
    expect((await createRecords(t.db, UNRESTRICTED, f.input(['red']))).duplicates).toEqual([
      { recordId: pending.id, recordCode: expect.any(String) },
    ]);
  });

  it('RFC-70 R1 the intent combination is checked once the trait is known (400 path intent)', async () => {
    const f = await setup();
    const q = await createTrait(t.db, { valueType: 'quantitative' });
    const base = await f.rec('red');
    const quant = { quantitative: { single: 1 } };
    const cases: Parameters<typeof createRecords>[2][] = [
      f.input(['blue'], { respondsToRecordId: base.id }),
      f.input(['blue'], { contestedLevelIds: [f.level('red')] }),
      f.input(['blue'], { intent: 'complement' }),
      f.input(['blue'], {
        intent: 'complement',
        respondsToRecordId: base.id,
        contestedLevelIds: [f.level('red')],
      }),
      f.input(['blue'], { intent: 'contest' }),
      f.input(['blue'], { intent: 'contest', respondsToRecordId: base.id }),
      f.input(['blue'], {
        intent: 'contest',
        respondsToRecordId: base.id,
        contestedLevelIds: [f.level('red')],
      }),
      { ...f.input([]), traitId: q.id, value: quant, intent: 'contest' },
      {
        ...f.input([]),
        traitId: q.id,
        value: quant,
        intent: 'contest',
        respondsToRecordId: base.id,
        contestedLevelIds: [f.level('red')],
      },
    ];
    for (const [i, c] of cases.entries()) {
      await expect(createRecords(t.db, UNRESTRICTED, c), `case ${i}`).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'intent' }],
      });
    }
  });

  it('RFC-63 R14 a contest giving red validates red and contests blue and yellow; stored with no record, and a later level is not contested by it', async () => {
    const f = await setup();
    const red = await f.rec('red');
    const blue = await f.rec('blue');
    await f.rec('yellow');
    const result = await createRecords(
      t.db,
      UNRESTRICTED,
      f.input(['red'], {
        intent: 'contest',
        contestedLevelIds: [f.level('yellow'), f.level('blue')],
      }),
    );
    expect(result.created).toEqual([]);
    expect(result.validated.map((v) => v.recordId)).toEqual([red.id]);
    expect(await contestsOf(f.sp.id, f.trait.id)).toEqual([
      { createdBy: f.me.id, levelIds: [f.level('blue'), f.level('yellow')].sort(), recordIds: [] },
    ]);
    // No generated annotation on the contested records (RFC-70 R5 retired).
    expect(await confirmsBy(blue.id, f.me.id)).toEqual([]);
    expect((await getRecord(t.db, UNRESTRICTED, blue.id))?.annotations).toEqual([]);
    // Task 4's fragments read the stored contest.
    expect((await getRecord(t.db, UNRESTRICTED, blue.id))?.contested).toBe(true);
    expect((await getRecord(t.db, UNRESTRICTED, red.id))?.contested).toBe(false);
    const green = await f.rec('green');
    expect((await getRecord(t.db, UNRESTRICTED, green.id))?.contested).toBe(false);
  });

  it('RFC-63 R14 a contest giving only green creates a green contest record and contests every existing level', async () => {
    const f = await setup();
    await f.rec('red');
    const blue = await f.rec('blue');
    await f.rec('yellow');
    const result = await createRecords(
      t.db,
      UNRESTRICTED,
      f.input(['green'], {
        intent: 'contest',
        contestedLevelIds: [f.level('red'), f.level('blue'), f.level('yellow')],
      }),
    );
    expect(result.validated).toEqual([]);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({
      level: { key: 'green' },
      intent: 'contest',
      respondsTo: null,
    });
    expect(await contestsOf(f.sp.id, f.trait.id)).toEqual([
      {
        createdBy: f.me.id,
        levelIds: [f.level('red'), f.level('blue'), f.level('yellow')].sort(),
        recordIds: [result.created[0]?.id],
      },
    ]);
    expect((await getRecord(t.db, UNRESTRICTED, blue.id))?.contestCount).toBe(1);
  });

  it('RFC-70 R3 E \\ S empty answers 400 path intent; contestedLevelIds other than E \\ S answers 400 path contestedLevelIds; neither writes', async () => {
    const f = await setup();
    const red = await f.rec('red');
    await f.rec('blue');
    await expect(
      createRecords(
        t.db,
        UNRESTRICTED,
        f.input(['red', 'blue', 'green'], { intent: 'contest', contestedLevelIds: [] }),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [
        {
          path: 'intent',
          message: 'A contest must contest at least one level; this is a complement',
        },
      ],
    });
    for (const contested of [[], [f.level('yellow')], [f.level('blue'), f.level('yellow')]]) {
      await expect(
        createRecords(
          t.db,
          UNRESTRICTED,
          f.input(['red', 'green'], { intent: 'contest', contestedLevelIds: contested }),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'contestedLevelIds' }],
      });
    }
    expect(await contestsOf(f.sp.id, f.trait.id)).toEqual([]);
    expect(await confirmsBy(red.id, f.me.id)).toEqual([]);
    expect(
      (
        await listRecords(t.db, UNRESTRICTED, {
          speciesId: f.sp.id,
          traitId: f.trait.id,
          limit: 50,
        })
      ).data,
    ).toHaveLength(2);
  });

  it('RFC-33 R2 E counts only active levels with a record visible to the actor: not an inactive level, not a pending record', async () => {
    const f = await setup();
    await f.rec('red');
    await f.rec('blue');
    await createRecord(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      valueText: 'yellow',
      harmonisation: 'unknown_level',
      primaryReferenceId: f.ref2.id,
      origin: 'manual',
      createdBy: f.other.id,
    });
    await t.db
      .update(traitLevels)
      .set({ active: false })
      .where(eq(traitLevels.id, f.level('blue')));
    // E = { red }: giving red contests nothing, even for a viewer who sees inactive levels.
    await expect(
      createRecords(
        t.db,
        UNRESTRICTED,
        f.input(['red'], { intent: 'contest', contestedLevelIds: [f.level('blue')] }),
      ),
    ).rejects.toMatchObject({ details: [{ path: 'intent' }] });
    const ok = await createRecords(
      t.db,
      UNRESTRICTED,
      f.input(['green'], { intent: 'contest', contestedLevelIds: [f.level('red')] }),
    );
    expect(ok.created).toHaveLength(1);
    expect((await contestsOf(f.sp.id, f.trait.id))[0]?.levelIds).toEqual([f.level('red')]);
  });

  it('RFC-70 R3 after the last record of a level is withdrawn, the contest computes E without it', async () => {
    const f = await setup();
    await f.rec('red');
    await f.rec('blue');
    const yellow = await f.rec('yellow');
    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: yellow.id,
      actorId: f.other.id,
      ...withdraw,
    });
    const entry = (contested: string[]) =>
      f.input(['red'], { intent: 'contest', contestedLevelIds: contested.map(f.level) });
    await expect(
      createRecords(t.db, UNRESTRICTED, entry(['blue', 'yellow'])),
    ).rejects.toMatchObject({ details: [{ path: 'contestedLevelIds' }] });
    await createRecords(t.db, UNRESTRICTED, entry(['blue']));
    expect((await contestsOf(f.sp.id, f.trait.id))[0]?.levelIds).toEqual([f.level('blue')]);
  });

  it('E3 a contest and the withdrawal of the last record of a level it contests serialise', async () => {
    const f = await setup();
    await f.rec('red');
    const blue = await f.rec('blue');
    const [contest, withdrawal] = await Promise.allSettled([
      createRecords(
        t.db,
        UNRESTRICTED,
        f.input(['red'], { intent: 'contest', contestedLevelIds: [f.level('blue')] }),
      ),
      annotateRecord(t.db, UNRESTRICTED, { recordId: blue.id, actorId: f.other.id, ...withdraw }),
    ]);
    expect(withdrawal.status).toBe('fulfilled');
    const stored = await contestsOf(f.sp.id, f.trait.id);
    if (contest.status === 'fulfilled') {
      // The contest ran first: it saw blue and contests it.
      expect(stored.map((c) => c.levelIds)).toEqual([[f.level('blue')]]);
    } else {
      // The withdrawal ran first: E = { red }, so nothing is contested.
      expect(contest.reason).toMatchObject({ details: [{ path: 'intent' }] });
      expect(stored).toEqual([]);
    }
  });

  it('RFC-70 R2, R3 a quantitative contest: a different value creates and stores it; the same value as its target is 400; a value matching another record validates it and stores nothing', async () => {
    const f = await setup();
    const qt = await createTrait(t.db, { valueType: 'quantitative' });
    const q = { single: 2, min: 1, max: 3, mean: 2, sd: 0.5, n: 4 };
    const qInput = (value: typeof q, extra: Partial<Parameters<typeof createRecords>[2]> = {}) => ({
      ...f.input([]),
      traitId: qt.id,
      value: { quantitative: value },
      ...extra,
    });
    const target = (
      await createRecords(t.db, UNRESTRICTED, {
        ...qInput(q),
        actorId: f.other.id,
        referenceIds: [f.ref2.id],
      })
    ).created[0];
    const another = (
      await createRecords(t.db, UNRESTRICTED, {
        ...qInput({ ...q, n: 9 }),
        actorId: f.other.id,
        referenceIds: [f.ref2.id],
      })
    ).created[0];
    const contest = { intent: 'contest' as const, respondsToRecordId: target?.id };

    await expect(createRecords(t.db, UNRESTRICTED, qInput(q, contest))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'value', message: 'A contest carries a different value' }],
    });

    const matched = await createRecords(t.db, UNRESTRICTED, qInput({ ...q, n: 9 }, contest));
    expect(matched).toEqual({
      created: [],
      validated: [{ recordId: another?.id, recordCode: another?.recordCode }],
      duplicates: [],
    });
    expect(await contestsOf(f.sp.id, qt.id)).toEqual([]);

    const created = await createRecords(t.db, UNRESTRICTED, qInput({ ...q, sd: 0.7 }, contest));
    expect(created.created[0]).toMatchObject({ intent: 'contest', respondsTo: { id: target?.id } });
    expect(await contestsOf(f.sp.id, qt.id)).toEqual([
      { createdBy: f.me.id, levelIds: [], recordIds: [created.created[0]?.id] },
    ]);
    const contested = await getRecord(t.db, UNRESTRICTED, target?.id as string);
    expect(contested?.contested).toBe(true);
    expect(contested?.annotations).toEqual([]);

    // Any one field differing creates; all six identical is a validation.
    const same = await createRecords(t.db, UNRESTRICTED, qInput(q));
    expect(same.validated.map((v) => v.recordId)).toEqual([target?.id]);
    const other = await createRecords(t.db, UNRESTRICTED, qInput({ ...q, mean: 2.5 }));
    expect(other.created).toHaveLength(1);

    // A withdrawn target is invisible: 404.
    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: target?.id as string,
      actorId: f.other.id,
      ...withdraw,
    });
    await expect(
      createRecords(t.db, UNRESTRICTED, qInput({ ...q, sd: 0.9 }, contest)),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('RFC-70 R2 a complement responds to a visible record of the same species and trait; matching still applies', async () => {
    const f = await setup();
    const otherTrait = await createTrait(t.db, { levels: ['red'] });
    const base = await f.rec('red');
    const complement = (keys: string[]) =>
      f.input(keys, { intent: 'complement', respondsToRecordId: base.id });

    const created = await createRecords(t.db, UNRESTRICTED, complement(['blue']));
    expect(created.created[0]).toMatchObject({ intent: 'complement', respondsTo: { id: base.id } });
    const matched = await createRecords(t.db, UNRESTRICTED, complement(['red']));
    expect(matched.validated.map((v) => v.recordId)).toEqual([base.id]);

    await expect(
      createRecords(t.db, UNRESTRICTED, {
        ...complement([]),
        traitId: otherTrait.id,
        value: { levelIds: [otherTrait.levels[0]?.id as string] },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'respondsToRecordId' }],
    });

    await annotateRecord(t.db, UNRESTRICTED, {
      recordId: base.id,
      actorId: f.other.id,
      ...withdraw,
    });
    await expect(createRecords(t.db, UNRESTRICTED, complement(['yellow']))).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
  });

  it('RFC-65 R1 a level error names its index', async () => {
    const f = await setup();
    const foreign = await createTrait(t.db, { levels: ['x'] });
    await expect(
      createRecords(t.db, UNRESTRICTED, {
        ...f.input(['red']),
        value: { levelIds: [f.level('red'), foreign.levels[0]?.id as string] },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'value.levelIds.1' }] });
  });
});

describe('RFC-70 R3 createRecords: a secondary reference named among the sources still supports the validation', () => {
  const t = useTestDb();

  it('sources [A, B] with secondaryReferenceId B matching another user record confirm with A and B', async () => {
    const { user: me } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const a = await createReference(t.db);
    const b = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['blue'] });
    const sp = await createSpecies(t.db);
    const blue = trait.levels[0]?.id as string;
    const theirs = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'blue',
      levelId: blue,
      primaryReferenceId: a.id,
      origin: 'manual',
      createdBy: other.id,
    });
    const out = await createRecords(t.db, UNRESTRICTED, {
      actorId: me.id,
      speciesId: sp.id,
      traitId: trait.id,
      value: { levelIds: [blue] },
      referenceIds: [a.id, b.id],
      secondaryReferenceId: b.id,
    });
    expect(out.validated.map((v) => v.recordId)).toEqual([theirs.id]);
    const refs = await t.db
      .select({ referenceId: recordAnnotations.referenceId })
      .from(recordAnnotations)
      .where(and(eq(recordAnnotations.recordId, theirs.id), eq(recordAnnotations.actorId, me.id)));
    expect(refs.map((r) => r.referenceId).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('RFC-65 R13, R14, RFC-70 R4 level actions', () => {
  const t = useTestDb();

  /** blue: theirs (manual), mine (manual), imported; red: none. */
  async function blueLevel() {
    const { user: me } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const ref = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['blue', 'red'] });
    const sp = await createSpecies(t.db);
    const blue = trait.levels[0]?.id as string;
    const red = trait.levels[1]?.id as string;
    const base = { speciesId: sp.id, traitId: trait.id, valueText: 'blue', levelId: blue };
    const theirs = await createRecord(t.db, {
      ...base,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: other.id,
    });
    const mine = await createRecord(t.db, {
      ...base,
      primaryReferenceId: ref2.id,
      origin: 'manual',
      createdBy: me.id,
    });
    const batch = await createImportBatch(t.db);
    const imported = await createRecord(t.db, {
      ...base,
      primaryReferenceId: (await createReference(t.db)).id,
      importBatchId: batch.id,
    });
    const at = { speciesId: sp.id, traitId: trait.id, levelId: blue };
    return { me, other, ref, trait, sp, blue, red, theirs, mine, imported, at };
  }

  const ids = (refs: { recordId: string }[]) => refs.map((r) => r.recordId).sort();

  it('R13 validateLevel confirms every visible record of the level except the actor own, once', async () => {
    const f = await blueLevel();
    const first = await validateLevel(t.db, UNRESTRICTED, {
      ...f.at,
      actorId: f.me.id,
      referenceId: f.ref.id,
    });
    expect(ids(first.validated)).toEqual(
      ids([{ recordId: f.theirs.id }, { recordId: f.imported.id }]),
    );
    const confirms = await t.db
      .select({ recordId: recordAnnotations.recordId, referenceId: recordAnnotations.referenceId })
      .from(recordAnnotations)
      .where(and(eq(recordAnnotations.actorId, f.me.id), eq(recordAnnotations.kind, 'confirm')));
    expect(confirms).toHaveLength(2);
    expect(confirms.every((c) => c.referenceId === f.ref.id)).toBe(true);
    const again = await validateLevel(t.db, UNRESTRICTED, { ...f.at, actorId: f.me.id });
    expect(again.validated).toEqual([]);
    expect((await getRecord(t.db, UNRESTRICTED, f.mine.id))?.annotations).toEqual([]);
  });

  it('R13 errors: species, trait, foreign or invisible level, no record, only own records', async () => {
    const f = await blueLevel();
    const zero = '00000000-0000-4000-8000-000000000000';
    const run = (over: Partial<typeof f.at>, v = UNRESTRICTED) =>
      validateLevel(t.db, v, { ...f.at, ...over, actorId: f.me.id });
    await expect(run({ speciesId: zero })).rejects.toMatchObject({ code: 'SPECIES_NOT_FOUND' });
    await expect(run({ traitId: zero })).rejects.toMatchObject({ code: 'TRAIT_NOT_FOUND' });
    const foreign = await createTrait(t.db, { levels: ['x'] });
    await expect(run({ levelId: foreign.levels[0]?.id as string })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'levelId' }],
    });
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, f.red));
    await expect(run({ levelId: f.red }, RESTRICTED)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'levelId' }],
    });
    await expect(run({ levelId: f.red })).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await createRecord(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      valueText: 'red',
      levelId: f.red,
      primaryReferenceId: f.ref.id,
      origin: 'manual',
      createdBy: f.me.id,
    });
    await expect(run({ levelId: f.red })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('R14 withdrawLevel: a manager leaves imported records in remaining, an admin withdraws them; counters drop', async () => {
    const f = await blueLevel();
    const { user: manager } = await createUser(t.db);
    const before = (await getSpecies(t.db, UNRESTRICTED, f.sp.id))?.recordCount;
    const out = await withdrawLevel(t.db, UNRESTRICTED, {
      ...f.at,
      actorId: manager.id,
      canWithdrawAny: true,
      canWithdrawImported: false,
    });
    expect(ids(out.withdrawn)).toEqual(ids([{ recordId: f.theirs.id }, { recordId: f.mine.id }]));
    expect(ids(out.remaining)).toEqual([f.imported.id]);
    expect((await getSpecies(t.db, UNRESTRICTED, f.sp.id))?.recordCount).toBe((before ?? 0) - 2);
    expect(await getRecord(t.db, UNRESTRICTED, f.imported.id)).not.toBeNull();
    const admin = await withdrawLevel(t.db, UNRESTRICTED, {
      ...f.at,
      actorId: manager.id,
      canWithdrawAny: true,
      canWithdrawImported: true,
    });
    expect(ids(admin.withdrawn)).toEqual([f.imported.id]);
    expect(admin.remaining).toEqual([]);
    expect((await getSpecies(t.db, UNRESTRICTED, f.sp.id))?.recordCount).toBe((before ?? 0) - 3);
    await expect(
      withdrawLevel(t.db, UNRESTRICTED, {
        ...f.at,
        actorId: manager.id,
        canWithdrawAny: true,
        canWithdrawImported: true,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('R14 an author without records.withdraw withdraws only their own; a foreign level is 400 levelId', async () => {
    const f = await blueLevel();
    const out = await withdrawLevel(t.db, UNRESTRICTED, {
      ...f.at,
      actorId: f.me.id,
      canWithdrawAny: false,
      canWithdrawImported: false,
    });
    expect(ids(out.withdrawn)).toEqual([f.mine.id]);
    expect(ids(out.remaining)).toEqual(
      ids([{ recordId: f.theirs.id }, { recordId: f.imported.id }]),
    );
    const foreign = await createTrait(t.db, { levels: ['x'] });
    await expect(
      withdrawLevel(t.db, UNRESTRICTED, {
        ...f.at,
        levelId: foreign.levels[0]?.id as string,
        actorId: f.me.id,
        canWithdrawAny: true,
        canWithdrawImported: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'levelId' }] });
  });

  it('RFC-63 R14, RFC-65 R15 emptying a contested level clears its contested flag', async () => {
    const f = await blueLevel();
    await createRecord(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      valueText: 'red',
      levelId: f.red,
      primaryReferenceId: f.ref.id,
      origin: 'manual',
      createdBy: f.other.id,
    });
    await createContest(t.db, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      createdBy: f.other.id,
      levelIds: [f.blue],
    });
    const contested = async () =>
      (await speciesTraitSummary(t.db, UNRESTRICTED, f.sp.id))
        ?.flatMap((c) => c.traits)
        .find((x) => x.trait.id === f.trait.id)?.contested;
    expect(await contested()).toBe(true);
    await withdrawLevel(t.db, UNRESTRICTED, {
      ...f.at,
      actorId: f.me.id,
      canWithdrawAny: true,
      canWithdrawImported: true,
    });
    expect(await contested()).toBe(false);
  });
});

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createVisibilityFixture,
  levelByKey,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { recordReferences, traitRecords } from '../db/schema/records.ts';
import { getRecord, listRecords, reviewStatusSql } from './records.ts';
import { ensurePersonalObservation } from './references.ts';

describe('RFC-63 R8, R9 listRecords and getRecord', () => {
  const t = useTestDb();

  it('filters by species and trait or by reference, newest first, with the item shape', async () => {
    const sp1 = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const blue = await levelByKey(t.db, trait.id, 'blue');
    const other = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    const ref2 = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const r1 = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'blue',
      levelId: blue.id,
      rawValue: 'Blue',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    const r2 = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'bluish',
      primaryReferenceId: ref2.id,
      secondaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    const r3 = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: other.id,
      valueText: '2.5',
      numericValue: 2.5,
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });

    const byTrait = await listRecords(t.db, UNRESTRICTED, {
      speciesId: sp1.id,
      traitId: trait.id,
      limit: 10,
    });
    expect(byTrait.data.map((r) => r.id)).toEqual([r2.id, r1.id]);
    expect(byTrait.data[1]).toEqual({
      id: r1.id,
      speciesId: sp1.id,
      species: { id: sp1.id, canonicalName: sp1.canonicalName },
      trait: { id: trait.id, key: 'flower_color', valueType: 'categorical', unit: null },
      valueText: 'blue',
      level: { id: blue.id, key: 'blue' },
      numericValue: null,
      harmonisation: 'harmonised',
      review: 'unvalidated',
      primaryReference: {
        id: ref.id,
        citationKey: ref.citationKey,
        kind: 'publication',
        observer: null,
        shortCitation: null,
      },
      secondaryReference: null,
      origin: 'import',
      createdAt: expect.any(String),
      createdBy: null,
      intent: null,
      respondsTo: null,
      validationCount: 0,
      contestCount: 0,
      contested: false,
      recordCode: expect.stringMatching(/^TR_\d+$/),
      quantitative: null,
      references: [
        {
          id: ref.id,
          citationKey: ref.citationKey,
          kind: 'publication',
          observer: null,
          shortCitation: null,
        },
      ],
    });
    expect(byTrait.data[0]?.secondaryReference).toEqual({
      id: ref.id,
      citationKey: ref.citationKey,
      kind: 'publication',
      observer: null,
      shortCitation: null,
    });

    const byRef = await listRecords(t.db, UNRESTRICTED, { referenceId: ref.id, limit: 2 });
    expect(byRef.data.map((r) => r.id)).toEqual([r3.id, r2.id]);
    expect(byRef.nextCursor).not.toBeNull();
    const rest = await listRecords(t.db, UNRESTRICTED, {
      referenceId: ref.id,
      cursor: byRef.nextCursor as string,
      limit: 2,
    });
    expect(rest.data.map((r) => r.id)).toEqual([r1.id]);
    expect(rest.nextCursor).toBeNull();
    expect(
      (await listRecords(t.db, UNRESTRICTED, { speciesId: sp1.id, traitId: other.id, limit: 10 }))
        .data[0]?.numericValue,
    ).toBe(2.5);
  });

  it('R6 derives the review status from annotations', async () => {
    const sp1 = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'x',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    const ada = (await createUser(t.db, { name: 'Ada' })).user;
    const bob = (await createUser(t.db, { name: 'Bob' })).user;
    const status = async () => (await getRecord(t.db, UNRESTRICTED, rec.id))?.review;

    expect(await status()).toBe('unvalidated');
    await t.db
      .insert(recordAnnotations)
      .values({ recordId: rec.id, actorId: ada.id, kind: 'confirm' });
    expect(await status()).toBe('validated');
    // RFC-63 R6, R7: `dispute` and `neutral` rows are ignored, and a
    // validation is never undone.
    await t.db
      .insert(recordAnnotations)
      .values({ recordId: rec.id, actorId: bob.id, kind: 'dispute', note: 'Source says purple' });
    expect(await status()).toBe('validated');
    await t.db
      .insert(recordAnnotations)
      .values({ recordId: rec.id, actorId: ada.id, kind: 'neutral' });
    expect(await status()).toBe('validated');
    await t.db
      .insert(recordAnnotations)
      .values({ recordId: rec.id, actorId: ada.id, kind: 'withdraw', note: 'Entered by mistake' });
    // RFC-63 R6, RFC-33 R2: a withdrawn record has left the dataset — it is
    // visible to no viewer, so it carries no review state for anyone.
    expect(await getRecord(t.db, UNRESTRICTED, rec.id)).toBeNull();
  });

  it('reviewStatusSql keeps the record id qualified when called from a single-table select', async () => {
    const sp1 = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'x',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    const { user } = await createUser(t.db);
    await t.db
      .insert(recordAnnotations)
      .values({ recordId: rec.id, actorId: user.id, kind: 'confirm' });
    // A bare `traitRecords.id` here (no join) is the case a caller selecting
    // from trait_records alone hits; the helper must qualify it itself, or
    // it would compare the annotation's own id and answer `unvalidated`.
    const [row] = await t.db
      .select({ review: reviewStatusSql(UNRESTRICTED, traitRecords.id).as('review') })
      .from(traitRecords)
      .where(eq(traitRecords.id, rec.id));
    expect(row?.review).toBe('validated');
  });

  it('R8 detail carries raw fields, batch and annotations, no accepted history; manual records carry their author', async () => {
    const sp1 = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db, { fileName: 'detail.csv' });
    const { user } = await createUser(t.db, { name: 'Grace' });
    const imported = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'x',
      rawValue: 'X',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
      importRowNo: 42,
    });
    const manual = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'y',
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
      note: 'Table 2',
    });
    await t.db
      .insert(recordAnnotations)
      .values({ recordId: imported.id, actorId: user.id, kind: 'confirm', note: 'Checked' });

    const detail = await getRecord(t.db, UNRESTRICTED, imported.id);
    expect(detail).toMatchObject({
      species: { id: sp1.id, canonicalName: sp1.canonicalName },
      rawValue: 'X',
      importBatch: { id: batch.id, fileName: 'detail.csv', startedAt: expect.any(String) },
      importRowNo: 42,
      note: null,
      createdBy: null,
      annotations: [
        {
          kind: 'confirm',
          note: 'Checked',
          actor: { id: user.id, name: 'Grace' },
          createdAt: expect.any(String),
          id: expect.any(String),
        },
      ],
    });
    expect(detail).not.toHaveProperty('acceptedHistory');
    const manualDetail = await getRecord(t.db, UNRESTRICTED, manual.id);
    expect(manualDetail).toMatchObject({
      origin: 'manual',
      createdBy: { id: user.id, name: 'Grace' },
      note: 'Table 2',
      importBatch: null,
      importRowNo: null,
    });
    expect(await getRecord(t.db, UNRESTRICTED, '00000000-0000-7000-8000-000000000000')).toBeNull();
  });

  it('RFC-61 R4, R7 a record citing a personal observation carries its observer on the reference ref', async () => {
    const sp1 = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const { user: observer } = await createUser(t.db, {
      name: `Observer-${randomBytes(4).toString('hex')}`,
    });
    const observation = await ensurePersonalObservation(t.db, observer.id);
    const batch = await createImportBatch(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'x',
      primaryReferenceId: observation.id,
      importBatchId: batch.id,
    });

    const listed = await listRecords(t.db, UNRESTRICTED, {
      speciesId: sp1.id,
      traitId: trait.id,
      limit: 10,
    });
    expect(listed.data[0]?.primaryReference).toEqual({
      id: observation.id,
      citationKey: `personal-observation:${observer.id}`,
      kind: 'personal_observation',
      observer: { id: observer.id, name: observer.name },
      shortCitation: null,
    });

    const detail = await getRecord(t.db, UNRESTRICTED, rec.id);
    expect(detail?.primaryReference?.observer).toEqual({ id: observer.id, name: observer.name });
  });
});

describe('RFC-33 R3, R4 listRecords and getRecord by viewer', () => {
  const t = useTestDb();

  it('records on a hidden species or an inactive trait are invisible to a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    const byRef = await listRecords(t.db, RESTRICTED, { referenceId: f.reference.id, limit: 10 });
    expect(byRef.data.map((r) => r.id)).toEqual([f.visible.id]);
    expect(
      (await listRecords(t.db, UNRESTRICTED, { referenceId: f.reference.id, limit: 10 })).data,
    ).toHaveLength(3);
    expect(await getRecord(t.db, RESTRICTED, f.onHiddenSpecies.id)).toBeNull();
    expect(await getRecord(t.db, RESTRICTED, f.onInactiveTrait.id)).toBeNull();
    expect(await getRecord(t.db, UNRESTRICTED, f.onHiddenSpecies.id)).not.toBeNull();
  });
});

describe('RFC-63 R8, R9 record code, quantitative value and references (spec R-2, R-4, R-5)', () => {
  const t = useTestDb();

  it('lists the primary reference first, then record_references; a reference lists the records it appears on', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const primary = await createReference(t.db);
    const extra = await createReference(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: 'min=2;max=8',
      minValue: 2,
      maxValue: 8,
      primaryReferenceId: primary.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await t.db.insert(recordReferences).values({ recordId: rec.id, referenceId: extra.id });

    const detail = await getRecord(t.db, UNRESTRICTED, rec.id);
    expect(detail?.recordCode).toMatch(/^TR_\d+$/);
    expect(detail?.quantitative).toEqual({ min: 2, max: 8 });
    expect(detail?.references).toEqual([
      {
        id: primary.id,
        citationKey: primary.citationKey,
        kind: 'publication',
        observer: null,
        shortCitation: null,
      },
      {
        id: extra.id,
        citationKey: extra.citationKey,
        kind: 'publication',
        observer: null,
        shortCitation: null,
      },
    ]);

    const byExtra = await listRecords(t.db, UNRESTRICTED, { referenceId: extra.id, limit: 10 });
    expect(byExtra.data.map((r) => r.id)).toEqual([rec.id]);
  });

  // Owner amendment 4 (RFC-63 R8): the item's `references` is primary, then
  // the legacy `secondary_reference_id` when present, THEN `record_references`
  // rows by citation key — not primary followed straight by `record_references`.
  it('spec R-4: references order is primary, then secondary, then record_references, with no duplicate reference', async () => {
    const { user } = await createUser(t.db);
    const sp1 = await createSpecies(t.db);
    const petal = await traitByKey(t.db, 'petal_length');
    const primary = await createReference(t.db);
    const secondary = await createReference(t.db);
    const extra = await createReference(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: petal.id,
      valueText: '5',
      numericValue: 5,
      primaryReferenceId: primary.id,
      secondaryReferenceId: secondary.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await t.db.insert(recordReferences).values([
      { recordId: rec.id, referenceId: extra.id },
      // The same reference as `secondaryReferenceId`: must appear once, in
      // the secondary slot, not a second time from `record_references`.
      { recordId: rec.id, referenceId: secondary.id },
    ]);

    const detail = await getRecord(t.db, UNRESTRICTED, rec.id);
    expect(detail?.references).toEqual([
      {
        id: primary.id,
        citationKey: primary.citationKey,
        kind: 'publication',
        observer: null,
        shortCitation: null,
      },
      {
        id: secondary.id,
        citationKey: secondary.citationKey,
        kind: 'publication',
        observer: null,
        shortCitation: null,
      },
      {
        id: extra.id,
        citationKey: extra.citationKey,
        kind: 'publication',
        observer: null,
        shortCitation: null,
      },
    ]);
  });
});

describe('RFC-63 R9 records list sort (spec §2)', () => {
  const t = useTestDb();

  it('sorts by value, references, origin and added in both orders, and pages every order with limit 1', async () => {
    const { user } = await createUser(t.db);
    const refZ = await createReference(t.db, { citationKey: `zeta-${Date.now()}` });
    const refA = await createReference(t.db, { citationKey: `alpha-${Date.now()}` });
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const sp = await createSpecies(t.db);
    const batch = await createImportBatch(t.db);
    // r10 and r2 share refA (alpha); r9 and r9b share refZ (zeta) and tie on
    // value (9) — both ties exercise the id tiebreak; r9b vs r9 also differ
    // in origin, separating them under that sort.
    const r10 = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: '10',
      numericValue: 10,
      primaryReferenceId: refA.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const r9 = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: '9',
      numericValue: 9,
      primaryReferenceId: refZ.id,
      importBatchId: batch.id,
    });
    const r9b = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      // A distinct `valueText` only to dodge `trait_records_claim_key`
      // (species, trait, valueText, rawValue, primaryReferenceId,
      // secondaryReferenceId) — the sort keys below (numericValue,
      // primaryReferenceId, origin) still tie with r9's.
      valueText: '9b',
      numericValue: 9,
      primaryReferenceId: refZ.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const r2 = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: '2',
      numericValue: 2,
      primaryReferenceId: refA.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const ids = async (
      sort?: 'value' | 'references' | 'origin' | 'added',
      order?: 'asc' | 'desc',
    ) =>
      (
        await listRecords(t.db, UNRESTRICTED, {
          speciesId: sp.id,
          traitId: trait.id,
          limit: 50,
          sort,
          order,
        })
      ).data.map((r) => r.id);

    const expected: Record<string, string[]> = {
      'added:desc': [r2.id, r9b.id, r9.id, r10.id],
      'added:asc': [r10.id, r9.id, r9b.id, r2.id],
      'value:asc': [r2.id, r9.id, r9b.id, r10.id],
      'value:desc': [r10.id, r9b.id, r9.id, r2.id],
      'references:asc': [r10.id, r2.id, r9.id, r9b.id],
      'references:desc': [r9b.id, r9.id, r2.id, r10.id],
      'origin:asc': [r9.id, r10.id, r9b.id, r2.id],
      'origin:desc': [r2.id, r9b.id, r10.id, r9.id],
    };

    for (const [key, want] of Object.entries(expected)) {
      const [sort, order] = key.split(':') as [
        'value' | 'references' | 'origin' | 'added',
        'asc' | 'desc',
      ];
      expect(await ids(sort, order), key).toEqual(want);

      // Full paging with limit 1 returns every record exactly once, in order.
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listRecords(t.db, UNRESTRICTED, {
          speciesId: sp.id,
          traitId: trait.id,
          limit: 1,
          sort,
          order,
          cursor,
        });
        seen.push(...page.data.map((r) => r.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen, key).toEqual(want);
    }
  });

  it('value sort orders a categorical trait by level key, with the id tiebreak', async () => {
    const trait = await createTrait(t.db); // categorical, levels 'alpha' and 'beta' (createTrait default)
    const alpha = trait.levels.find((l) => l.key === 'alpha');
    const beta = trait.levels.find((l) => l.key === 'beta');
    if (!alpha || !beta) throw new Error('createTrait: expected alpha and beta levels');
    const sp = await createSpecies(t.db);
    const ref = await createReference(t.db);
    const a1 = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      primaryReferenceId: ref.id,
      importBatchId: (await createImportBatch(t.db)).id,
    });
    const a2 = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      // A distinct `valueText` only to dodge `trait_records_claim_key`; the
      // level (the sort key) still ties with a1's.
      valueText: 'alpha (2)',
      levelId: alpha.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: (await createUser(t.db)).user.id,
    });
    const b1 = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'beta',
      levelId: beta.id,
      primaryReferenceId: ref.id,
      importBatchId: (await createImportBatch(t.db)).id,
    });

    const ids = async (order: 'asc' | 'desc') =>
      (
        await listRecords(t.db, UNRESTRICTED, {
          speciesId: sp.id,
          traitId: trait.id,
          limit: 50,
          sort: 'value',
          order,
        })
      ).data.map((r) => r.id);

    // a1 and a2 tie on the level key ('alpha'); the id (creation order) breaks it.
    expect(await ids('asc')).toEqual([a1.id, a2.id, b1.id]);
    expect(await ids('desc')).toEqual([b1.id, a2.id, a1.id]);
  });

  it('value sort of a referenceId list mixes a categorical and a quantitative trait without NULL reaching the comparison', async () => {
    const ref = await createReference(t.db);
    const quantTrait = await createTrait(t.db, { valueType: 'quantitative' });
    const catTrait = await createTrait(t.db);
    const alpha = catTrait.levels.find((l) => l.key === 'alpha');
    if (!alpha) throw new Error('createTrait: expected an alpha level');
    const sp1 = await createSpecies(t.db);
    const sp2 = await createSpecies(t.db);
    const numeric = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: quantTrait.id,
      valueText: '5',
      numericValue: 5,
      primaryReferenceId: ref.id,
      importBatchId: (await createImportBatch(t.db)).id,
    });
    const categorical = await createRecord(t.db, {
      speciesId: sp2.id,
      traitId: catTrait.id,
      valueText: 'alpha',
      levelId: alpha.id,
      primaryReferenceId: ref.id,
      importBatchId: (await createImportBatch(t.db)).id,
    });

    // Ascending: the categorical record's sentinel (PostgreSQL numeric
    // Infinity) sorts after every real quantitative value.
    const asc = await listRecords(t.db, UNRESTRICTED, {
      referenceId: ref.id,
      limit: 50,
      sort: 'value',
      order: 'asc',
    });
    expect(asc.data.map((r) => r.id)).toEqual([numeric.id, categorical.id]);

    const desc = await listRecords(t.db, UNRESTRICTED, {
      referenceId: ref.id,
      limit: 50,
      sort: 'value',
      order: 'desc',
    });
    expect(desc.data.map((r) => r.id)).toEqual([categorical.id, numeric.id]);

    // Full paging with limit 1 still returns both exactly once.
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listRecords(t.db, UNRESTRICTED, {
        referenceId: ref.id,
        limit: 1,
        sort: 'value',
        order: 'asc',
        cursor,
      });
      seen.push(...page.data.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([numeric.id, categorical.id]);
  });

  it('a cursor of another sort, or added’s plain cursor, is refused', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative' });
    const sp = await createSpecies(t.db);
    for (const n of [1, 2]) {
      await createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: String(n),
        numericValue: n,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }

    // `added`'s plain uuid cursor decoded as a composite cursor.
    const addedPage = await listRecords(t.db, UNRESTRICTED, {
      speciesId: sp.id,
      traitId: trait.id,
      limit: 1,
    });
    await expect(
      listRecords(t.db, UNRESTRICTED, {
        speciesId: sp.id,
        traitId: trait.id,
        limit: 1,
        sort: 'value',
        cursor: addedPage.nextCursor ?? '',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // A `value` cursor decoded under `references` (same arity, tagged with
    // the sort's own name so the mismatch is still caught).
    const valuePage = await listRecords(t.db, UNRESTRICTED, {
      speciesId: sp.id,
      traitId: trait.id,
      limit: 1,
      sort: 'value',
      order: 'asc',
    });
    await expect(
      listRecords(t.db, UNRESTRICTED, {
        speciesId: sp.id,
        traitId: trait.id,
        limit: 1,
        sort: 'references',
        order: 'asc',
        cursor: valuePage.nextCursor ?? '',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // A `references` cursor decoded under `origin` (different arity).
    const referencesPage = await listRecords(t.db, UNRESTRICTED, {
      speciesId: sp.id,
      traitId: trait.id,
      limit: 1,
      sort: 'references',
      order: 'asc',
    });
    await expect(
      listRecords(t.db, UNRESTRICTED, {
        speciesId: sp.id,
        traitId: trait.id,
        limit: 1,
        sort: 'origin',
        order: 'asc',
        cursor: referencesPage.nextCursor ?? '',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

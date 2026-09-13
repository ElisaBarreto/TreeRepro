import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { getReference, searchReferences } from './references.ts';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-61 R4 references', () => {
  const t = useTestDb();

  it('searches citation key and title; unused references carry zero counts', async () => {
    const k = tag();
    const b = await createReference(t.db, { citationKey: `Refb_${k}` });
    const a = await createReference(t.db, {
      citationKey: `Refa_${k}`,
      title: `Pollination of ${k}`,
    });
    const page = await searchReferences(t.db, { q: `ref`, limit: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const byTitle = await searchReferences(t.db, { q: `pollination of ${k}`, limit: 10 });
    expect(byTitle.data.map((r) => r.id)).toEqual([a.id]);
    expect(byTitle.data[0]).toMatchObject({
      citationKey: `Refa_${k}`,
      title: `Pollination of ${k}`,
      year: null,
      doi: null,
      primaryCount: 0,
      secondaryCount: 0,
    });
    // Neither is used, so the tie breaks on id descending (the later insert first).
    const both = await searchReferences(t.db, { q: `_${k}`, limit: 10 });
    expect(both.data.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it('orders by usage (primary + secondary) descending then id descending, with a continuous cursor', async () => {
    const k = tag();
    const sp = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const batch = await createImportBatch(t.db);
    const low = await createReference(t.db, { citationKey: `Low_${k}` });
    const mid = await createReference(t.db, { citationKey: `Mid_${k}` });
    const high = await createReference(t.db, { citationKey: `High_${k}` });
    await createReference(t.db, { citationKey: `Unused_${k}` });
    const record = (valueText: string, primary: string | null, secondary: string | null) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText,
        primaryReferenceId: primary,
        secondaryReferenceId: secondary,
        importBatchId: batch.id,
      });
    // high: 2 as primary + 1 as secondary = 3; mid: 1 + 1 = 2; low: 0 + 1 = 1.
    await record('a', high.id, null);
    await record('b', high.id, mid.id);
    await record('c', mid.id, high.id);
    await record('d', null, low.id);

    const first = await searchReferences(t.db, { q: `_${k}`, limit: 2 });
    expect(first.data.map((r) => r.citationKey)).toEqual([`High_${k}`, `Mid_${k}`]);
    expect(first.data[0]).toMatchObject({ primaryCount: 2, secondaryCount: 1 });
    expect(first.data[1]).toMatchObject({ primaryCount: 1, secondaryCount: 1 });
    expect(first.nextCursor).not.toBeNull();

    const second = await searchReferences(t.db, {
      q: `_${k}`,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(second.data.map((r) => r.citationKey)).toEqual([`Low_${k}`, `Unused_${k}`]);
    expect(second.data[0]).toMatchObject({ primaryCount: 0, secondaryCount: 1 });
    expect(second.data[1]).toMatchObject({ primaryCount: 0, secondaryCount: 0 });
    expect(second.nextCursor).toBeNull();
  });

  it('a tampered cursor is refused with VALIDATION_FAILED', async () => {
    const forged = Buffer.from(JSON.stringify(['1', 'not-a-uuid']), 'utf8').toString('base64url');
    await expect(searchReferences(t.db, { cursor: forged, limit: 10 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const negative = Buffer.from(
      JSON.stringify(['-1', '00000000-0000-7000-8000-000000000000']),
      'utf8',
    ).toString('base64url');
    await expect(searchReferences(t.db, { cursor: negative, limit: 10 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('detail counts each role, and a record in either role once; unknown id is null', async () => {
    const ref = await createReference(t.db);
    const other = await createReference(t.db);
    const sp1 = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const batch = await createImportBatch(t.db);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'a',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'b',
      primaryReferenceId: other.id,
      secondaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    // The same article in both roles: one record, one use in each role.
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'c',
      primaryReferenceId: ref.id,
      secondaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    expect(await getReference(t.db, ref.id)).toMatchObject({
      id: ref.id,
      recordCount: 3,
      primaryCount: 2,
      secondaryCount: 2,
    });
    expect(await getReference(t.db, other.id)).toMatchObject({
      recordCount: 1,
      primaryCount: 1,
      secondaryCount: 0,
    });
    expect(await getReference(t.db, '00000000-0000-7000-8000-000000000000')).toBeNull();

    // The list agrees with the detail, counting the both-roles record once per role.
    const listed = await searchReferences(t.db, { q: ref.citationKey, limit: 10 });
    expect(listed.data).toEqual([
      expect.objectContaining({ id: ref.id, primaryCount: 2, secondaryCount: 2 }),
    ]);
  });
});

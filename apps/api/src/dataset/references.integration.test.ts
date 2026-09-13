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

  it('searches citation key and title, orders by key, paginates', async () => {
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
    });
    const both = await searchReferences(t.db, { q: `_${k}`, limit: 10 });
    expect(both.data.map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it('detail counts records naming it as primary or secondary; unknown id is null', async () => {
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
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'c',
      primaryReferenceId: ref.id,
      secondaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    expect((await getReference(t.db, ref.id))?.recordCount).toBe(3);
    expect((await getReference(t.db, other.id))?.recordCount).toBe(1);
    expect(await getReference(t.db, '00000000-0000-7000-8000-000000000000')).toBeNull();
  });
});

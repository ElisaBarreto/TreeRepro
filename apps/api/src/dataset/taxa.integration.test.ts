import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createFamily,
  createGenus,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { getSpecies, likePattern, listFamilies, listGenera, searchSpecies } from './taxa.ts';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-60 R6 searchSpecies', () => {
  const t = useTestDb();

  it('matches canonical and alternative names case-insensitively, reports matchedName, orders by name', async () => {
    const k = tag();
    const family = await createFamily(t.db, { name: `Searchaceae-${k}` });
    const genus = await createGenus(t.db, { name: `Searchus-${k}`, familyId: family.id });
    const b = await createSpecies(t.db, { canonicalName: `Searchus beta-${k}`, genusId: genus.id });
    const a = await createSpecies(t.db, {
      canonicalName: `Searchus alpha-${k}`,
      genusId: genus.id,
      names: [{ name: `Oldname alpha-${k}`, gbifUsageKey: '77' }],
    });
    const page = await searchSpecies(t.db, { q: `us alpha-${k}`, limit: 10 });
    expect(page.data.map((s) => s.id)).toEqual([a.id]);
    expect(page.data[0]).toMatchObject({
      canonicalName: `Searchus alpha-${k}`,
      nameSource: 'wcvp',
      genus: { id: genus.id, name: `Searchus-${k}` },
      family: { id: family.id, name: `Searchaceae-${k}` },
      matchedName: null,
    });
    const viaAlternative = await searchSpecies(t.db, { q: `oldname alpha-${k}`, limit: 10 });
    expect(viaAlternative.data.map((s) => s.id)).toEqual([a.id]);
    expect(viaAlternative.data[0]?.matchedName).toBe(`Oldname alpha-${k}`);
    const byGenus = await searchSpecies(t.db, { genusId: genus.id, limit: 10 });
    expect(byGenus.data.map((s) => s.id)).toEqual([a.id, b.id]);
    const byFamily = await searchSpecies(t.db, { familyId: family.id, limit: 10 });
    expect(byFamily.data).toHaveLength(2);
  });

  it('paginates with a composite cursor and escapes LIKE metacharacters', async () => {
    const k = tag();
    const names = [`Pagus a-${k}`, `Pagus b-${k}`, `Pagus c-${k}`];
    for (const n of names) await createSpecies(t.db, { canonicalName: n });
    const first = await searchSpecies(t.db, { q: `pagus`, limit: 2 });
    // other files may create Pagus species; assert on ordering and continuity only
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchSpecies(t.db, {
      q: 'pagus',
      cursor: first.nextCursor as string,
      limit: 2,
    });
    expect(
      (second.data[0]?.canonicalName as string) > (first.data[1]?.canonicalName as string),
    ).toBe(true);
    const literal = await searchSpecies(t.db, { q: `%-${k}`, limit: 10 });
    expect(literal.data).toEqual([]); // '%' is literal, nothing contains it
    expect(likePattern('a%b_c', 'substring')).toBe('%a\\%b\\_c%');
    expect(likePattern('Ab', 'prefix')).toBe('Ab%');
  });

  it('R3 unresolved=true keeps unresolved taxa and unresolved taxonomy only', async () => {
    const k = tag();
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    await createSpecies(t.db, { canonicalName: `Unres ok-${k}`, genusId: genus.id });
    const noGenus = await createSpecies(t.db, { canonicalName: `Unres nogenus-${k}` });
    const gbif = await createSpecies(t.db, {
      canonicalName: `Unres gbif-${k}`,
      nameSource: 'gbif',
      genusId: genus.id,
    });
    const orphanGenus = await createGenus(t.db);
    const noFamily = await createSpecies(t.db, {
      canonicalName: `Unres nofamily-${k}`,
      genusId: orphanGenus.id,
    });
    const page = await searchSpecies(t.db, { q: `unres`, unresolved: true, limit: 50 });
    const ids = page.data.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([noGenus.id, gbif.id, noFamily.id]));
    expect(page.data.some((s) => s.canonicalName === `Unres ok-${k}`)).toBe(false);
  });
});

describe('RFC-60 R7 getSpecies', () => {
  const t = useTestDb();

  it('adds names, counts and the unresolved flag; unknown id is null', async () => {
    const k = tag();
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const sp1 = await createSpecies(t.db, {
      canonicalName: `Detail sp-${k}`,
      genusId: genus.id,
      names: [{ name: `Detail alt-${k}` }],
    });
    const trait = await traitByKey(t.db, 'flower_color');
    const other = await traitByKey(t.db, 'petal_length');
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'x',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'y',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: other.id,
      valueText: '1',
      numericValue: 1,
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    const found = await getSpecies(t.db, sp1.id);
    expect(found).toMatchObject({
      id: sp1.id,
      names: [{ name: `Detail alt-${k}`, source: 'gbif', gbifUsageKey: null }],
      recordCount: 3,
      traitCount: 2,
      unresolvedTaxon: false,
      matchedName: null,
    });
    const orphan = await createSpecies(t.db, { nameSource: 'original' });
    expect((await getSpecies(t.db, orphan.id))?.unresolvedTaxon).toBe(true);
    expect(await getSpecies(t.db, '00000000-0000-7000-8000-000000000000')).toBeNull();
  });
});

describe('RFC-60 R8 families and genera', () => {
  const t = useTestDb();

  it('lists by name with a composite cursor; genera filter by family and prefix', async () => {
    const k = tag();
    const family = await createFamily(t.db, { name: `Listaceae-${k}` });
    await createGenus(t.db, { name: `Listus b-${k}`, familyId: family.id });
    await createGenus(t.db, { name: `Listus a-${k}`, familyId: family.id });
    await createGenus(t.db, { name: `Other-${k}`, familyId: family.id });
    const genera = await listGenera(t.db, { familyId: family.id, q: 'listus', limit: 1 });
    expect(genera.data.map((g) => g.name)).toEqual([`Listus a-${k}`]);
    expect(genera.data[0]?.family).toEqual({ id: family.id, name: `Listaceae-${k}` });
    const next = await listGenera(t.db, {
      familyId: family.id,
      q: 'listus',
      cursor: genera.nextCursor as string,
      limit: 1,
    });
    expect(next.data.map((g) => g.name)).toEqual([`Listus b-${k}`]);
    expect(next.nextCursor).toBeNull();
    const families = await listFamilies(t.db, { limit: 200 });
    expect(families.data.some((f) => f.id === family.id)).toBe(true);
    const sorted = [...families.data.map((f) => f.name)].sort((a, b) => a.localeCompare(b, 'en'));
    expect(families.data.map((f) => f.name)).toEqual(sorted);
  });
});

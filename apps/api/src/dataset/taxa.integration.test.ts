import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { species } from '../db/schema/taxa.ts';
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
    const page = await searchSpecies(t.db, UNRESTRICTED, { q: `us alpha-${k}`, limit: 10 });
    expect(page.data.map((s) => s.id)).toEqual([a.id]);
    expect(page.data[0]).toMatchObject({
      canonicalName: `Searchus alpha-${k}`,
      nameSource: 'wcvp',
      genus: { id: genus.id, name: `Searchus-${k}` },
      family: { id: family.id, name: `Searchaceae-${k}` },
      matchedName: null,
    });
    const viaAlternative = await searchSpecies(t.db, UNRESTRICTED, {
      q: `oldname alpha-${k}`,
      limit: 10,
    });
    expect(viaAlternative.data.map((s) => s.id)).toEqual([a.id]);
    expect(viaAlternative.data[0]?.matchedName).toBe(`Oldname alpha-${k}`);
    const byGenus = await searchSpecies(t.db, UNRESTRICTED, { genusId: genus.id, limit: 10 });
    expect(byGenus.data.map((s) => s.id)).toEqual([a.id, b.id]);
    const byFamily = await searchSpecies(t.db, UNRESTRICTED, { familyId: family.id, limit: 10 });
    expect(byFamily.data).toHaveLength(2);
  });

  it('paginates with a composite cursor and escapes LIKE metacharacters', async () => {
    const k = tag();
    const names = [`Pagus a-${k}`, `Pagus b-${k}`, `Pagus c-${k}`];
    for (const n of names) await createSpecies(t.db, { canonicalName: n });
    const first = await searchSpecies(t.db, UNRESTRICTED, { q: `pagus`, limit: 2 });
    // other files may create Pagus species; assert on ordering and continuity only
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchSpecies(t.db, UNRESTRICTED, {
      q: 'pagus',
      cursor: first.nextCursor as string,
      limit: 2,
    });
    expect(
      (second.data[0]?.canonicalName as string) > (first.data[1]?.canonicalName as string),
    ).toBe(true);
    const literal = await searchSpecies(t.db, UNRESTRICTED, { q: `%-${k}`, limit: 10 });
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
    const page = await searchSpecies(t.db, UNRESTRICTED, {
      q: `unres`,
      unresolved: true,
      limit: 50,
    });
    const ids = page.data.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([noGenus.id, gbif.id, noFamily.id]));
    expect(page.data.some((s) => s.canonicalName === `Unres ok-${k}`)).toBe(false);
  });

  it('R6 every item carries unresolvedTaxon (R3: name source, missing genus or missing family)', async () => {
    const k = tag();
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const resolved = await createSpecies(t.db, {
      canonicalName: `Flagus resolved-${k}`,
      genusId: genus.id,
    });
    const noGenus = await createSpecies(t.db, { canonicalName: `Flagus nogenus-${k}` });
    const gbif = await createSpecies(t.db, {
      canonicalName: `Flagus gbif-${k}`,
      nameSource: 'gbif',
      genusId: genus.id,
    });
    const { data } = await searchSpecies(t.db, UNRESTRICTED, { q: `Flagus`, limit: 50 });
    const flag = (id: string) => data.find((s) => s.id === id)?.unresolvedTaxon;
    expect(flag(resolved.id)).toBe(false);
    expect(flag(noGenus.id)).toBe(true);
    expect(flag(gbif.id)).toBe(true);
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
    const found = await getSpecies(t.db, UNRESTRICTED, sp1.id);
    expect(found).toMatchObject({
      id: sp1.id,
      names: [{ name: `Detail alt-${k}`, source: 'gbif', gbifUsageKey: null }],
      recordCount: 3,
      traitCount: 2,
      unresolvedTaxon: false,
      matchedName: null,
    });
    const orphan = await createSpecies(t.db, { nameSource: 'original' });
    expect((await getSpecies(t.db, UNRESTRICTED, orphan.id))?.unresolvedTaxon).toBe(true);
    expect(await getSpecies(t.db, UNRESTRICTED, '00000000-0000-7000-8000-000000000000')).toBeNull();
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
    const genera = await listGenera(t.db, UNRESTRICTED, {
      familyId: family.id,
      q: 'listus',
      limit: 1,
    });
    expect(genera.data.map((g) => g.name)).toEqual([`Listus a-${k}`]);
    expect(genera.data[0]?.family).toEqual({ id: family.id, name: `Listaceae-${k}` });
    const next = await listGenera(t.db, UNRESTRICTED, {
      familyId: family.id,
      q: 'listus',
      cursor: genera.nextCursor as string,
      limit: 1,
    });
    expect(next.data.map((g) => g.name)).toEqual([`Listus b-${k}`]);
    expect(next.nextCursor).toBeNull();
    const families = await listFamilies(t.db, UNRESTRICTED, { limit: 200 });
    expect(families.data.some((f) => f.id === family.id)).toBe(true);
    const sorted = [...families.data.map((f) => f.name)].sort((a, b) => a.localeCompare(b, 'en'));
    expect(families.data.map((f) => f.name)).toEqual(sorted);
  });
});

describe('RFC-33 R2, R3 species visibility', () => {
  const t = useTestDb();

  it('a restricted viewer never lists or reads an inactive species; an unrestricted one does with active=false', async () => {
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const name = `Hidden vis-${Math.random().toString(16).slice(2)}`;
    const hidden = await createSpecies(t.db, { canonicalName: name, genusId: genus.id });
    await t.db.update(species).set({ active: false }).where(eq(species.id, hidden.id));

    const restricted = await searchSpecies(t.db, RESTRICTED, { q: name, limit: 10 });
    expect(restricted.data).toEqual([]);
    const unrestricted = await searchSpecies(t.db, UNRESTRICTED, { q: name, limit: 10 });
    expect(unrestricted.data.map((s) => [s.id, s.active])).toEqual([[hidden.id, false]]);
    const onlyInactive = await searchSpecies(t.db, UNRESTRICTED, {
      q: name,
      status: 'inactive',
      limit: 10,
    });
    expect(onlyInactive.data).toHaveLength(1);
    const forcedActive = await searchSpecies(t.db, RESTRICTED, {
      q: name,
      status: 'all',
      limit: 10,
    });
    expect(forcedActive.data).toEqual([]);

    expect(await getSpecies(t.db, RESTRICTED, hidden.id)).toBeNull();
    expect((await getSpecies(t.db, UNRESTRICTED, hidden.id))?.active).toBe(false);

    // a genus and family whose only species is hidden disappear for the restricted viewer
    const genera = await listGenera(t.db, RESTRICTED, { familyId: family.id, limit: 10 });
    expect(genera.data.map((g) => g.id)).not.toContain(genus.id);
    // Walk the family list to the page that would hold this family (names sort; the
    // random suffix can land anywhere), then assert absence vs presence on that page.
    const pageHolding = async (v: typeof RESTRICTED) => {
      let cursor: string | undefined;
      for (;;) {
        const page = await listFamilies(t.db, v, { limit: 200, cursor });
        const last = page.data[page.data.length - 1];
        if (!page.nextCursor || !last || last.name >= family.name)
          return page.data.map((f) => f.id);
        cursor = page.nextCursor;
      }
    };
    expect(await pageHolding(RESTRICTED)).not.toContain(family.id);
    expect(await pageHolding(UNRESTRICTED)).toContain(family.id);
    expect(
      (await listGenera(t.db, UNRESTRICTED, { familyId: family.id, limit: 10 })).data.map(
        (g) => g.id,
      ),
    ).toContain(genus.id);
  });
});

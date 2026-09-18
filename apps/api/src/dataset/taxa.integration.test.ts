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
  createTrait,
  createVisibilityFixture,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { traitCategories } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import { speciesTraitSummary } from './summary.ts';
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

describe('RFC-60 R6 search tiers', () => {
  const t = useTestDb();

  it('an exact canonical match answers alone (case-insensitive); otherwise canonical and alternative substrings match together, with the type', async () => {
    const stem = `Tier${tag()}`;
    const exact = await createSpecies(t.db, { canonicalName: `${stem} robur` });
    const longer = await createSpecies(t.db, { canonicalName: `${stem} robur var. alba` });
    const bySyn = await createSpecies(t.db, {
      canonicalName: `Other ${tag()}`,
      names: [{ name: `${stem} robur old`, nameType: 'synonym' }],
    });
    const q1 = await searchSpecies(t.db, UNRESTRICTED, { q: `${stem} ROBUR`, limit: 10 });
    expect(q1.data.map((s) => s.id)).toEqual([exact.id]); // tier 1: the synonym holder and the longer name are not listed
    const q2 = await searchSpecies(t.db, UNRESTRICTED, { q: `${stem} rob`, limit: 10 });
    expect(q2.data.map((s) => s.id).sort()).toEqual([exact.id, longer.id, bySyn.id].sort()); // tier 2 = today's search
    expect(q2.data.find((s) => s.id === bySyn.id)?.matchedNameType).toBe('synonym');
    const q3 = await searchSpecies(t.db, UNRESTRICTED, { q: `robur old`, limit: 10 });
    expect(q3.data.map((s) => [s.id, s.matchedName, s.matchedNameType])).toEqual([
      [bySyn.id, `${stem} robur old`, 'synonym'],
    ]);
  });

  it('the cursor stays within the tier', async () => {
    const stem = `Page${tag()}`;
    const exact = await createSpecies(t.db, { canonicalName: stem });
    await createSpecies(t.db, { canonicalName: `${stem} b` });
    const p1 = await searchSpecies(t.db, UNRESTRICTED, { q: stem, limit: 1 });
    expect(p1.data.map((s) => s.id)).toEqual([exact.id]);
    expect(p1.nextCursor).toBeNull(); // tier 1 holds one row; the substring match of tier 2 is never paged into
  });

  it('a cursor minted under one sort is rejected, not mis-decoded, under the other (the leading tier key does not change the arity rule)', async () => {
    const stem = `Sort${tag()}`;
    await createSpecies(t.db, { canonicalName: `${stem} a` });
    await createSpecies(t.db, { canonicalName: `${stem} b` });
    const byName = await searchSpecies(t.db, UNRESTRICTED, { q: stem, limit: 1 });
    expect(byName.nextCursor).not.toBeNull();
    await expect(
      searchSpecies(t.db, UNRESTRICTED, {
        q: stem,
        sort: 'completeness',
        cursor: byName.nextCursor as string,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'cursor' }] });
    const byCompleteness = await searchSpecies(t.db, UNRESTRICTED, {
      q: stem,
      sort: 'completeness',
      limit: 1,
    });
    expect(byCompleteness.nextCursor).not.toBeNull();
    await expect(
      searchSpecies(t.db, UNRESTRICTED, {
        q: stem,
        cursor: byCompleteness.nextCursor as string,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'cursor' }] });
  });
});

describe('RFC-60 R7 getSpecies', () => {
  const t = useTestDb();

  it('names carry type, language and source, ordered gbif, synonym, common, then name', async () => {
    const k = tag();
    const sp = await createSpecies(t.db, {
      canonicalName: `Order sp-${k}`,
      names: [
        { name: `Order common b-${k}`, nameType: 'common', language: 'pt' },
        { name: `Order gbif-${k}`, nameType: 'gbif', gbifUsageKey: '9' },
        { name: `Order synonym-${k}`, nameType: 'synonym', source: 'WCVP' },
        { name: `Order common a-${k}`, nameType: 'common', language: 'en' },
      ],
    });
    const found = await getSpecies(t.db, UNRESTRICTED, sp.id);
    expect(found?.names).toEqual([
      {
        name: `Order gbif-${k}`,
        nameType: 'gbif',
        language: null,
        source: 'gbif',
        gbifUsageKey: '9',
      },
      {
        name: `Order synonym-${k}`,
        nameType: 'synonym',
        language: null,
        source: 'WCVP',
        gbifUsageKey: null,
      },
      {
        name: `Order common a-${k}`,
        nameType: 'common',
        language: 'en',
        source: 'gbif',
        gbifUsageKey: null,
      },
      {
        name: `Order common b-${k}`,
        nameType: 'common',
        language: 'pt',
        source: 'gbif',
        gbifUsageKey: null,
      },
    ]);
  });

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

  // RFC-33 R9's two-viewer sweep for `getSpecies`, over the fixture's second
  // case: an active species with a record on an inactive trait.
  //
  // The detail's counts are deliberately NOT filtered by trait visibility, and
  // this test exists to say so where the next reviewer will read it. RFC-60 R7
  // returns "the item (R6)", whose `traitCount` RFC-60 R6 and RFC-69 R1 define
  // as visibility-blind by design — it counts every coverage row, including
  // rows on traits a curator has deactivated. Filtering it here would make the
  // same species report one number on its own page and another in the list row
  // beside it, per viewer, which no rule sanctions. RFC-33 R3 omits invisible
  // *rows* from lists and exempts counters outright ("Reference counters are
  // stored and unaffected"); it does not oblige an aggregate.
  //
  // What a restricted viewer may therefore infer — how many traits with data
  // they cannot see, never which or what — is a stated, bounded, accepted
  // exposure, the same one `recordCount` beside it already carries.
  it('RFC-33 R9 the detail counts are viewer-independent (RFC-69 R1: visibility-blind by design)', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    // `shownSpecies` is active and carries two records: one on an active trait,
    // one on an inactive trait.
    const restricted = await getSpecies(t.db, RESTRICTED, f.shownSpecies.id);
    const unrestricted = await getSpecies(t.db, UNRESTRICTED, f.shownSpecies.id);
    expect(restricted).toMatchObject({ recordCount: 2, traitCount: 2 });
    expect(unrestricted).toMatchObject({ recordCount: 2, traitCount: 2 });

    // ...while the trait list on the same page is filtered (RFC-33 R3), so the
    // divergence this pins is real and intended, not an oversight.
    const summary = await speciesTraitSummary(t.db, RESTRICTED, f.shownSpecies.id);
    expect(summary?.flatMap((c) => c.traits).map((x) => x.trait.id)).toEqual([f.activeTrait.id]);
  });
});

describe('RFC-60 R6 trait filters and completeness', () => {
  const t = useTestDb();

  it('filters with/missing by trait and by category; orders by completeness with a stable cursor', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const cat = `cat_${tag()}`;
    await t.db.insert(traitCategories).values({ key: cat, label: 'Cat', sortOrder: 99 });
    const tA = await createTrait(t.db, { categoryKey: cat });
    const tB = await createTrait(t.db, { categoryKey: cat });
    const prefix = `Cov ${tag()}`;
    const s0 = await createSpecies(t.db, { canonicalName: `${prefix} zero` });
    const s1 = await createSpecies(t.db, { canonicalName: `${prefix} one` });
    const s2 = await createSpecies(t.db, { canonicalName: `${prefix} two` });
    const rec = (sp: { id: string }, tr: typeof tA) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: tr.id,
        valueText: 'alpha',
        levelId: tr.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    await rec(s1, tA);
    await rec(s2, tA);
    await rec(s2, tB);
    const ids = (r: { data: { id: string }[] }) => r.data.map((x) => x.id);
    expect(
      ids(await searchSpecies(t.db, UNRESTRICTED, { q: prefix, traitId: tA.id, limit: 10 })).sort(),
    ).toEqual([s1.id, s2.id].sort());
    expect(
      ids(
        await searchSpecies(t.db, UNRESTRICTED, {
          q: prefix,
          traitId: tA.id,
          traitData: 'missing',
          limit: 10,
        }),
      ),
    ).toEqual([s0.id]);
    expect(
      ids(
        await searchSpecies(t.db, UNRESTRICTED, {
          q: prefix,
          categoryKey: cat,
          traitData: 'missing',
          limit: 10,
        }),
      ),
    ).toEqual([s0.id]);
    const byCompleteness = await searchSpecies(t.db, UNRESTRICTED, {
      q: prefix,
      sort: 'completeness',
      limit: 2,
    });
    expect(ids(byCompleteness)).toEqual([s0.id, s1.id]);
    expect(byCompleteness.data[1]?.traitCount).toBe(1);
    const next = await searchSpecies(t.db, UNRESTRICTED, {
      q: prefix,
      sort: 'completeness',
      limit: 2,
      cursor: byCompleteness.nextCursor ?? undefined,
    });
    expect(ids(next)).toEqual([s2.id]);
    const withCount = await searchSpecies(t.db, UNRESTRICTED, {
      q: prefix,
      traitId: tA.id,
      limit: 10,
    });
    expect(withCount.data.find((x) => x.id === s2.id)?.traitRecordCount).toBe(1);
    // The list reports `species.trait_count` (RFC-69 R1, maintained by the
    // insert trigger and never recomputed after the 0022 backfill); the detail
    // counts the records live (RFC-60 R7). They are meant to agree — pinned
    // here so a drift in the trigger cannot pass unnoticed.
    const detail = await getSpecies(t.db, UNRESTRICTED, s2.id);
    expect(detail?.traitCount).toBe(2);
    expect(detail?.traitCount).toBe(withCount.data.find((x) => x.id === s2.id)?.traitCount);
  });

  it('an invisible trait id answers TRAIT_NOT_FOUND; a category mismatch answers 400', async () => {
    const off = await createTrait(t.db, { active: false });
    await expect(
      searchSpecies(t.db, RESTRICTED, { traitId: off.id, limit: 10 }),
    ).rejects.toMatchObject({ code: 'TRAIT_NOT_FOUND' });
    const tr = await createTrait(t.db);
    await expect(
      searchSpecies(t.db, UNRESTRICTED, { traitId: tr.id, categoryKey: 'nope', limit: 10 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'categoryKey' }],
    });
    await expect(
      searchSpecies(t.db, UNRESTRICTED, { categoryKey: 'nope', limit: 10 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'categoryKey' }],
    });
  });

  // RFC-69 R4: `species_trait_coverage` has no `active` flag, so the only thing
  // keeping an invisible trait out of the filter is the `traits` join inside
  // `coverageExists`. The `traitId` path cannot reach it — `requireTrait` throws
  // first — so this goes through `categoryKey`, which resolves no trait.
  it('RFC-69 R4 an inactive trait is invisible to the coverage filter; with/missing stay complementary', async () => {
    const cat = `cat_${tag()}`;
    await t.db.insert(traitCategories).values({ key: cat, label: 'Cat', sortOrder: 99 });
    const shown = await createTrait(t.db, { categoryKey: cat });
    const hidden = await createTrait(t.db, { categoryKey: cat, active: false });
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const prefix = `Vis ${tag()}`;
    const onShown = await createSpecies(t.db, { canonicalName: `${prefix} shown` });
    const onHidden = await createSpecies(t.db, { canonicalName: `${prefix} hidden` });
    const none = await createSpecies(t.db, { canonicalName: `${prefix} none` });
    for (const [sp, tr] of [
      [onShown, shown],
      [onHidden, hidden],
    ] as const) {
      await createRecord(t.db, {
        speciesId: sp.id,
        traitId: tr.id,
        valueText: 'alpha',
        levelId: tr.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }
    const ids = async (v: typeof RESTRICTED, traitData: 'with' | 'missing') =>
      (
        await searchSpecies(t.db, v, { q: prefix, categoryKey: cat, traitData, limit: 10 })
      ).data.map((s) => s.id);

    // The species whose only records are on the inactive trait counts as
    // covered for a viewer who sees inactive traits...
    expect((await ids(UNRESTRICTED, 'with')).sort()).toEqual([onShown.id, onHidden.id].sort());
    expect(await ids(UNRESTRICTED, 'missing')).toEqual([none.id]);
    // ...and as missing for one who does not — the two modes partition the same
    // three species for each viewer, never dropping or doubling one.
    expect(await ids(RESTRICTED, 'with')).toEqual([onShown.id]);
    expect((await ids(RESTRICTED, 'missing')).sort()).toEqual([onHidden.id, none.id].sort());
  });
});

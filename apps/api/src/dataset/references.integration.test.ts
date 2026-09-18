import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED, type Visibility } from '../access/visibility.ts';
import { traitCategories } from '../db/schema/dictionary.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { updateReference } from './catalog.ts';
import {
  createReferenceFromDoi,
  ensurePersonalObservation,
  getReference,
  searchReferences,
} from './references.ts';

const tag = () => randomBytes(4).toString('hex');

/** A viewer who cannot see inactive traits (RFC-33 R2). */
const restricted: Visibility = { inactive: false, plotIds: null };

describe('RFC-61 R4 references', () => {
  const t = useTestDb();

  it('searches citation key and title; unused references carry zero counts', async () => {
    const k = tag();
    const b = await createReference(t.db, { citationKey: `Refb_${k}` });
    const a = await createReference(t.db, {
      citationKey: `Refa_${k}`,
      title: `Pollination of ${k}`,
    });
    // Scoped to this test's own two rows (an 8-hex-char random tag, matched
    // case-insensitively in upper case): an unscoped substring like `'ref'`
    // would match rows any parallel test file happens to have created.
    const page = await searchReferences(t.db, UNRESTRICTED, { q: k.toUpperCase(), limit: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const byTitle = await searchReferences(t.db, UNRESTRICTED, {
      q: `pollination of ${k}`,
      limit: 10,
    });
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
    const both = await searchReferences(t.db, UNRESTRICTED, { q: `_${k}`, limit: 10 });
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

    const first = await searchReferences(t.db, UNRESTRICTED, { q: `_${k}`, limit: 2 });
    expect(first.data.map((r) => r.citationKey)).toEqual([`High_${k}`, `Mid_${k}`]);
    expect(first.data[0]).toMatchObject({ primaryCount: 2, secondaryCount: 1 });
    expect(first.data[1]).toMatchObject({ primaryCount: 1, secondaryCount: 1 });
    expect(first.nextCursor).not.toBeNull();

    const second = await searchReferences(t.db, UNRESTRICTED, {
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
    await expect(
      searchReferences(t.db, UNRESTRICTED, { cursor: forged, limit: 10 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const negative = Buffer.from(
      JSON.stringify(['-1', '00000000-0000-7000-8000-000000000000']),
      'utf8',
    ).toString('base64url');
    await expect(
      searchReferences(t.db, UNRESTRICTED, { cursor: negative, limit: 10 }),
    ).rejects.toMatchObject({
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
    const listed = await searchReferences(t.db, UNRESTRICTED, { q: ref.citationKey, limit: 10 });
    expect(listed.data).toEqual([
      expect.objectContaining({ id: ref.id, primaryCount: 2, secondaryCount: 2 }),
    ]);
  });

  it('usage counters live on the reference row, maintained by the insert trigger for every write path', async () => {
    const ref = await createReference(t.db);
    const sp = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'flower_color');
    const batch = await createImportBatch(t.db);
    const stored = async () =>
      (
        await t.db
          .select({
            primaryCount: bibliographicReferences.primaryCount,
            secondaryCount: bibliographicReferences.secondaryCount,
            usageCount: bibliographicReferences.usageCount,
          })
          .from(bibliographicReferences)
          .where(eq(bibliographicReferences.id, ref.id))
      )[0];
    expect(await stored()).toEqual({ primaryCount: 0, secondaryCount: 0, usageCount: 0 });
    // A single-row insert (the manual writer's path).
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      primaryReferenceId: ref.id,
      secondaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    expect(await stored()).toEqual({ primaryCount: 1, secondaryCount: 1, usageCount: 2 });
    // A multi-row statement (the importer's path): one statement, both roles.
    await t.db.execute(sql`
      insert into trait_records (species_id, trait_id, value_text, harmonisation, primary_reference_id, secondary_reference_id, origin, import_batch_id, import_row_no)
      select ${sp.id}::uuid, ${trait.id}::uuid, 'bulk-' || g, 'unknown_level', ${ref.id}::uuid, case when g = 1 then ${ref.id}::uuid end, 'import', ${batch.id}::uuid, 900000 + g
      from generate_series(1, 3) g
    `);
    expect(await stored()).toEqual({ primaryCount: 4, secondaryCount: 2, usageCount: 6 });
    // The aggregate the detail still computes agrees with the counters.
    expect(await getReference(t.db, ref.id)).toMatchObject({
      recordCount: 4,
      primaryCount: 4,
      secondaryCount: 2,
    });
  });

  it('searchReferences omits personal observations by default; kind=all includes them with observer', async () => {
    const { user } = await createUser(t.db);
    const po = await ensurePersonalObservation(t.db, user.id);
    const pubTag = tag();
    const pub = await createReference(t.db, { citationKey: `Pub_${pubTag}` });

    // A publication is returned by a default-kind search, scoped to its own
    // unique citation key rather than to an arbitrary page of the table.
    const defPub = await searchReferences(t.db, UNRESTRICTED, { q: pubTag, limit: 10 });
    expect(defPub.data.some((r) => r.id === pub.id)).toBe(true);

    // ensurePersonalObservation gives the row citation key
    // `personal-observation:${userId}` (references.ts), so a search scoped to
    // this user's id would genuinely find `po` if the `kind` filter were not
    // applied — it must not be found by a default-kind search.
    const defPo = await searchReferences(t.db, UNRESTRICTED, { q: user.id, limit: 10 });
    expect(defPo.data.some((r) => r.id === po.id)).toBe(false);

    const all = await searchReferences(t.db, UNRESTRICTED, { q: user.id, limit: 10, kind: 'all' });
    const foundPo = all.data.find((r) => r.id === po.id);
    expect(foundPo).toBeDefined();
    expect(foundPo?.kind).toBe('personal_observation');
    expect(foundPo?.observer?.name).toBe(user.name);
  });

  it('updateReference on a personal observation throws REFERENCE_IS_PERSONAL', async () => {
    const { user } = await createUser(t.db);
    const po = await ensurePersonalObservation(t.db, user.id);
    await expect(
      updateReference(t.db, { id: po.id, title: 'new title', actorId: user.id }),
    ).rejects.toMatchObject({ code: 'REFERENCE_IS_PERSONAL' });
  });

  it('q also matches short_citation, case-insensitively', async () => {
    const k = tag();
    const ref = await createReference(t.db, { citationKey: `Plain_${k}` });
    await t.db
      .update(bibliographicReferences)
      .set({ shortCitation: `Alfaro (2023) ${k}` })
      .where(eq(bibliographicReferences.id, ref.id));
    const found = await searchReferences(t.db, UNRESTRICTED, {
      q: `ALFARO (2023) ${k}`,
      limit: 10,
    });
    expect(found.data.map((r) => r.id)).toEqual([ref.id]);
  });

  it('traitId keeps references with a reference_traits row for a visible trait; unknown or invisible id is 404', async () => {
    const { user } = await createUser(t.db);
    const k = tag();
    const trait = await createTrait(t.db, { levels: ['a'] });
    const otherTrait = await createTrait(t.db, { levels: ['a'] });
    const sp = await createSpecies(t.db);
    const withRef = await createReference(t.db, { citationKey: `With_${k}` });
    const withoutRef = await createReference(t.db, { citationKey: `Without_${k}` });
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: withRef.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: otherTrait.id,
      valueText: 'a',
      levelId: otherTrait.levels[0]?.id,
      primaryReferenceId: withoutRef.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const filtered = await searchReferences(t.db, UNRESTRICTED, {
      q: `_${k}`,
      limit: 10,
      traitId: trait.id,
    });
    expect(filtered.data.map((r) => r.id)).toEqual([withRef.id]);

    const inactiveTrait = await createTrait(t.db, { levels: ['a'], active: false });
    await expect(
      searchReferences(t.db, restricted, { limit: 10, traitId: inactiveTrait.id }),
    ).rejects.toMatchObject({ code: 'TRAIT_NOT_FOUND' });
    await expect(
      searchReferences(t.db, UNRESTRICTED, {
        limit: 10,
        traitId: '00000000-0000-7000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'TRAIT_NOT_FOUND' });
  });

  it('categoryKey keeps references with a row for any visible trait of the category; unknown key is 400', async () => {
    const { user } = await createUser(t.db);
    const k = tag();
    const [category] = await t.db
      .select({ key: traitCategories.key })
      .from(traitCategories)
      .limit(1);
    if (!category) throw new Error('no trait category (is the dictionary seeded?)');
    const visibleTrait = await createTrait(t.db, { levels: ['a'], categoryKey: category.key });
    const invisibleTrait = await createTrait(t.db, {
      levels: ['a'],
      categoryKey: category.key,
      active: false,
    });
    const sp = await createSpecies(t.db);
    const viaVisible = await createReference(t.db, { citationKey: `ViaVisible_${k}` });
    const viaInvisible = await createReference(t.db, { citationKey: `ViaInvisible_${k}` });
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: visibleTrait.id,
      valueText: 'a',
      levelId: visibleTrait.levels[0]?.id,
      primaryReferenceId: viaVisible.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createRecord(t.db, {
      speciesId: sp.id,
      traitId: invisibleTrait.id,
      valueText: 'a',
      levelId: invisibleTrait.levels[0]?.id,
      primaryReferenceId: viaInvisible.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const forRestricted = await searchReferences(t.db, restricted, {
      q: `_${k}`,
      limit: 10,
      categoryKey: category.key,
    });
    expect(forRestricted.data.map((r) => r.id)).toEqual([viaVisible.id]);

    const forUnrestricted = await searchReferences(t.db, UNRESTRICTED, {
      q: `_${k}`,
      limit: 10,
      categoryKey: category.key,
    });
    expect(forUnrestricted.data.map((r) => r.id).sort()).toEqual(
      [viaVisible.id, viaInvisible.id].sort(),
    );

    await expect(
      searchReferences(t.db, UNRESTRICTED, { limit: 10, categoryKey: `nope_${k}` }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('detail traits are ordered by recordCount descending and exclude invisible traits; recordCount is visibility-blind', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const sp1 = await createSpecies(t.db);
    const sp2 = await createSpecies(t.db);
    const traitLow = await createTrait(t.db, { levels: ['a'] });
    const traitHigh = await createTrait(t.db, { levels: ['a', 'b'] });
    const traitInvisible = await createTrait(t.db, { levels: ['a'], active: false });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: traitLow.id,
      valueText: 'a',
      levelId: traitLow.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: traitHigh.id,
      valueText: 'a',
      levelId: traitHigh.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createRecord(t.db, {
      speciesId: sp2.id,
      traitId: traitHigh.id,
      valueText: 'b',
      levelId: traitHigh.levels[1]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: traitInvisible.id,
      valueText: 'a',
      levelId: traitInvisible.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const detail = await getReference(t.db, ref.id, restricted);
    expect(detail?.traits).toEqual([
      {
        trait: {
          id: traitHigh.id,
          key: traitHigh.key,
          valueType: traitHigh.valueType,
          unit: traitHigh.unit,
        },
        recordCount: 2,
      },
      {
        trait: {
          id: traitLow.id,
          key: traitLow.key,
          valueType: traitLow.valueType,
          unit: traitLow.unit,
        },
        recordCount: 1,
      },
    ]);
    // The counters are the same for every viewer (RFC-33 R3): `recordCount`
    // still counts the record on the invisible trait, so the visible chips
    // (2 + 1) need not add up to it for this viewer.
    expect(detail).toMatchObject({ recordCount: 4, primaryCount: 4, secondaryCount: 0 });

    // The unrestricted viewer gets the third chip; the two singletons tie on
    // count and fall back to key order, which the random keys leave open.
    const unrestricted = await getReference(t.db, ref.id, UNRESTRICTED);
    expect(unrestricted?.traits[0]).toMatchObject({ trait: { id: traitHigh.id }, recordCount: 2 });
    expect(unrestricted?.traits.slice(1).map((t) => [t.trait.id, t.recordCount])).toEqual(
      expect.arrayContaining([
        [traitLow.id, 1],
        [traitInvisible.id, 1],
      ]),
    );
    expect(unrestricted?.traits).toHaveLength(3);
    expect(unrestricted).toMatchObject({ recordCount: 4, primaryCount: 4, secondaryCount: 0 });
  });
});

describe('RFC-61 R8 createReferenceFromDoi derives the display citations', () => {
  const t = useTestDb();

  it('stores the derived short citation and, when a title is present, the full citation', async () => {
    const { user } = await createUser(t.db);
    const k = tag();
    const created = await createReferenceFromDoi(t.db, {
      doi: `10.1111/geb.${k}`,
      metadata: {
        title: 'Seed size',
        authors: 'Alfaro, A; Diaz, B',
        year: 2023,
        journal: 'Global Ecology',
      },
      actorId: user.id,
    });
    expect(created.shortCitation).toBe('Alfaro and Diaz (2023)');
    expect(created.fullCitation).toBe(
      `Alfaro, A; Diaz, B (2023). Seed size. Global Ecology. https://doi.org/10.1111/geb.${k}`,
    );
  });

  it('stores a derived short citation with no full citation when there is no title', async () => {
    const { user } = await createUser(t.db);
    const k = tag();
    const created = await createReferenceFromDoi(t.db, {
      doi: `10.1111/notitle.${k}`,
      metadata: { title: null, authors: 'Alfaro, A', year: 2023, journal: null },
      actorId: user.id,
    });
    expect(created.shortCitation).toBe('Alfaro (2023)');
    expect(created.fullCitation).toBeNull();
  });

  it('stores no citations when there is no metadata', async () => {
    const { user } = await createUser(t.db);
    const k = tag();
    const created = await createReferenceFromDoi(t.db, {
      doi: `10.1111/nometa.${k}`,
      metadata: null,
      actorId: user.id,
    });
    expect(created.shortCitation).toBeNull();
    expect(created.fullCitation).toBeNull();
  });
});

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import type { Visibility } from '../access/visibility.ts';
import { traitLevels } from '../db/schema/dictionary.ts';
import { pendingTraits } from './queues.ts';
import { getRecord, listRecords } from './records.ts';
import { getReference } from './references.ts';
import { speciesTraitSummary } from './summary.ts';
import { getSpecies, searchSpecies } from './taxa.ts';

const REVIEWER: Visibility = { inactive: false, plotIds: null, review: true };

async function fixture(db: Parameters<typeof createUser>[0]) {
  const { user } = await createUser(db);
  const ref = await createReference(db);
  const trait = await createTrait(db, { levels: ['a'] });
  const sp = await createSpecies(db, { nameSource: 'original' });
  const kept = await createRecord(db, {
    speciesId: sp.id,
    traitId: trait.id,
    valueText: 'a',
    levelId: trait.levels[0]?.id,
    primaryReferenceId: ref.id,
    origin: 'manual',
    createdBy: user.id,
  });
  const gone = await createRecord(db, {
    speciesId: sp.id,
    traitId: trait.id,
    valueText: 'a',
    levelId: trait.levels[0]?.id,
    primaryReferenceId: ref.id,
    rawValue: 'second',
    origin: 'manual',
    createdBy: user.id,
  });
  const batch = await createImportBatch(db);
  const pending = await createRecord(db, {
    speciesId: sp.id,
    traitId: trait.id,
    valueText: 'zzz',
    primaryReferenceId: ref.id,
    importBatchId: batch.id,
  });
  await createAnnotation(db, { recordId: gone.id, actorId: user.id, kind: 'withdraw' });
  return { user, ref, trait, sp, kept, gone, pending };
}

describe('RFC-63 R6 a withdrawn record leaves every read (spec R-13)', () => {
  const t = useTestDb();

  it('lists, detail, summary, species counts and reference count skip it', async () => {
    const f = await fixture(t.db);
    const list = await listRecords(t.db, REVIEWER, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      limit: 50,
    });
    expect(list.data.map((r) => r.id).sort()).toEqual([f.kept.id, f.pending.id].sort());
    expect(await getRecord(t.db, REVIEWER, f.gone.id)).toBeNull();
    const summary = await speciesTraitSummary(t.db, REVIEWER, f.sp.id);
    const trait = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === f.trait.id);
    expect(trait?.recordCount).toBe(2);
    expect(trait?.levels).toEqual([expect.objectContaining({ key: 'a', count: 1 })]);
    expect((await getSpecies(t.db, REVIEWER, f.sp.id))?.recordCount).toBe(2);
    expect((await getReference(t.db, f.ref.id, REVIEWER))?.recordCount).toBe(2);
  });

  it('a withdrawn pending record leaves the harmonisation queue', async () => {
    const f = await fixture(t.db);
    await createAnnotation(t.db, { recordId: f.pending.id, actorId: f.user.id, kind: 'withdraw' });
    const traits = await pendingTraits(t.db, REVIEWER);
    expect(traits.find((x) => x.trait.id === f.trait.id)).toBeUndefined();
  });
});

describe('RFC-33 R1, R2 non-harmonised records and the unresolved flag are for records.review (spec R-14)', () => {
  const t = useTestDb();

  it('a contributor sees neither the pending record nor the unresolved flag; a reviewer sees both', async () => {
    const f = await fixture(t.db);
    const mine = await listRecords(t.db, RESTRICTED, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      limit: 50,
    });
    expect(mine.data.map((r) => r.id)).toEqual([f.kept.id]);
    expect(await getRecord(t.db, RESTRICTED, f.pending.id)).toBeNull();
    const summary = await speciesTraitSummary(t.db, RESTRICTED, f.sp.id);
    const trait = summary?.flatMap((c) => c.traits).find((x) => x.trait.id === f.trait.id);
    expect(trait?.recordCount).toBe(1);
    expect(trait?.harmonisationCounts.unknownLevel).toBe(0);
    expect((await getSpecies(t.db, RESTRICTED, f.sp.id))?.unresolvedTaxon).toBeNull();
    expect((await getSpecies(t.db, REVIEWER, f.sp.id))?.unresolvedTaxon).toBe(true);
    const page = await searchSpecies(t.db, RESTRICTED, { q: f.sp.canonicalName, limit: 5 });
    expect(page.data.find((s) => s.id === f.sp.id)?.unresolvedTaxon).toBeNull();
  });
});

describe('RFC-33 R2, R9 a record on an inactive level of an active trait is invisible without dataset.read_inactive', () => {
  const t = useTestDb();

  it('listRecords, getRecord and the species summary omit it for a restricted viewer and keep it for an unrestricted one', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['on', 'off'] });
    const offLevel = trait.levels.find((l) => l.key === 'off');
    if (!offLevel) throw new Error('missing level');
    await t.db.update(traitLevels).set({ active: false }).where(eq(traitLevels.id, offLevel.id));
    const sp = await createSpecies(t.db);
    const onActiveLevel = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'on',
      levelId: trait.levels.find((l) => l.key === 'on')?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    const onInactiveLevel = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'off',
      levelId: offLevel.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const restrictedList = await listRecords(t.db, RESTRICTED, {
      speciesId: sp.id,
      traitId: trait.id,
      limit: 50,
    });
    expect(restrictedList.data.map((r) => r.id)).toEqual([onActiveLevel.id]);
    const unrestrictedList = await listRecords(t.db, UNRESTRICTED, {
      speciesId: sp.id,
      traitId: trait.id,
      limit: 50,
    });
    expect(unrestrictedList.data.map((r) => r.id).sort()).toEqual(
      [onActiveLevel.id, onInactiveLevel.id].sort(),
    );

    expect(await getRecord(t.db, RESTRICTED, onInactiveLevel.id)).toBeNull();
    expect(await getRecord(t.db, UNRESTRICTED, onInactiveLevel.id)).not.toBeNull();

    const restrictedSummary = await speciesTraitSummary(t.db, RESTRICTED, sp.id);
    const restrictedTrait = restrictedSummary
      ?.flatMap((c) => c.traits)
      .find((x) => x.trait.id === trait.id);
    expect(restrictedTrait?.recordCount).toBe(1);
    const unrestrictedSummary = await speciesTraitSummary(t.db, UNRESTRICTED, sp.id);
    const unrestrictedTrait = unrestrictedSummary
      ?.flatMap((c) => c.traits)
      .find((x) => x.trait.id === trait.id);
    expect(unrestrictedTrait?.recordCount).toBe(2);
  });
});

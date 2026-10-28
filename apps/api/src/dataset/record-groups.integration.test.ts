import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  levelByKey,
  traitByKey,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { recordGroups } from './record-groups.ts';
import { listRecords } from './records.ts';

describe('RFC-63 R9, R18 records grouped by level × secondary reference (issue #349)', () => {
  const t = useTestDb();

  async function fixture() {
    const sp = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'dispersal_mode');
    const biotic = await levelByKey(t.db, trait.id, 'biotic');
    const abiotic = await levelByKey(t.db, trait.id, 'abiotic');
    const p1 = await createReference(t.db);
    const p2 = await createReference(t.db);
    const p3 = await createReference(t.db);
    const gift = await createReference(t.db, { citationKey: `B_GIFT_${randomUUID()}` });
    const try_ = await createReference(t.db, { citationKey: `A_TRY_${randomUUID()}` });
    const batch = await createImportBatch(t.db);
    const rec = (extra: object) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        importBatchId: batch.id,
        valueText: 'biotic',
        levelId: biotic.id,
        dispersalPhase: 'primary',
        ...extra,
      } as Parameters<typeof createRecord>[1]);
    // biotic × GIFT: three records, two references
    const a1 = await rec({ primaryReferenceId: p1.id, secondaryReferenceId: gift.id });
    const a2 = await rec({ primaryReferenceId: p2.id, secondaryReferenceId: gift.id });
    const a3 = await rec({
      primaryReferenceId: p2.id,
      secondaryReferenceId: gift.id,
      rawValue: 'zoochory',
    });
    // a copy of evidence is in no group (RFC-63 R17)
    await rec({
      primaryReferenceId: p3.id,
      secondaryReferenceId: gift.id,
      countsAsEvidence: false,
    });
    // biotic × TRY: one record, of the other phase
    const b = await rec({
      primaryReferenceId: p3.id,
      secondaryReferenceId: try_.id,
      dispersalPhase: 'secondary',
    });
    // biotic × no secondary article
    const c = await rec({ primaryReferenceId: p1.id });
    // abiotic × GIFT
    const d = await rec({
      valueText: 'abiotic',
      levelId: abiotic.id,
      primaryReferenceId: p1.id,
      secondaryReferenceId: gift.id,
    });
    // pending harmonisation: no level, a group of its own, reviewers only
    const e = await rec({ valueText: 'zoochor', levelId: undefined, primaryReferenceId: p1.id });
    const ada = (await createUser(t.db, { name: 'Ada' })).user;
    const bob = (await createUser(t.db, { name: 'Bob' })).user;
    await t.db.insert(recordAnnotations).values([
      { recordId: a1.id, actorId: ada.id, kind: 'confirm' },
      { recordId: a2.id, actorId: ada.id, kind: 'confirm' },
      { recordId: a3.id, actorId: bob.id, kind: 'confirm' },
    ]);
    return { sp, trait, biotic, abiotic, gift, try_, a1, a2, a3, b, c, d, e };
  }

  it('one group per level × secondary reference, in the fixed order, a single record inline', async () => {
    const f = await fixture();
    const { data, nextCursor } = await recordGroups(t.db, UNRESTRICTED, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      limit: 10,
    });
    expect(nextCursor).toBeNull();
    // biotic has 3 references, abiotic 1; within biotic most references
    // first, then no secondary article ('') before TRY; pending last.
    expect(
      data.map((g) => [
        g.level?.key ?? null,
        g.secondaryReference?.citationKey.split('_')[1] ?? null,
        g.nRecords,
        g.nReferences,
        g.record?.id ?? null,
      ]),
    ).toEqual([
      ['biotic', 'GIFT', 3, 2, null],
      ['biotic', null, 1, 1, f.c.id],
      ['biotic', 'TRY', 1, 1, f.b.id],
      ['abiotic', 'GIFT', 1, 1, f.d.id],
      [null, null, 1, 1, f.e.id],
    ]);
    expect(data[0]).toMatchObject({ validationCount: 2, contestCount: 0, contested: false });
    expect(data[0]?.level).toEqual({ id: f.biotic.id, key: 'biotic' });
    expect(data[0]?.secondaryReference?.id).toBe(f.gift.id);
  });

  it('pages under a keyset cursor and narrows by dispersal phase; a contributor never sees pending', async () => {
    const f = await fixture();
    const page = (cursor?: string) =>
      recordGroups(t.db, UNRESTRICTED, {
        speciesId: f.sp.id,
        traitId: f.trait.id,
        limit: 2,
        cursor,
      });
    const first = await page();
    expect(first.data.map((g) => g.record?.id ?? 'group')).toEqual(['group', f.c.id]);
    const second = await page(first.nextCursor ?? undefined);
    expect(second.data.map((g) => g.record?.id)).toEqual([f.b.id, f.d.id]);
    const third = await page(second.nextCursor ?? undefined);
    expect(third.data.map((g) => g.record?.id)).toEqual([f.e.id]);
    expect(third.nextCursor).toBeNull();

    const phase = await recordGroups(t.db, UNRESTRICTED, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      dispersalPhase: 'secondary',
      limit: 10,
    });
    expect(phase.data.map((g) => g.record?.id)).toEqual([f.b.id]);

    const contributor = await recordGroups(t.db, RESTRICTED, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      limit: 10,
    });
    expect(contributor.data.map((g) => g.level?.key ?? null)).not.toContain(null);
  });

  it('refuses a malformed cursor', async () => {
    const f = await fixture();
    await expect(
      recordGroups(t.db, UNRESTRICTED, {
        speciesId: f.sp.id,
        traitId: f.trait.id,
        limit: 2,
        cursor: 'not-a-cursor',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // a forged key past the int range is compared, not overflowed
    const forged = Buffer.from(
      JSON.stringify(['default', 'asc', '9999999999', 'biotic', '-9999999999', '', '', 'x']),
    ).toString('base64url');
    const page = await recordGroups(t.db, UNRESTRICTED, {
      speciesId: f.sp.id,
      traitId: f.trait.id,
      limit: 2,
      cursor: forged,
    });
    expect(page.data).toEqual([]);
  });

  it('secondaryReferenceId narrows the records list to one group (RFC-63 R9)', async () => {
    const f = await fixture();
    const list = (secondaryReferenceId: string) =>
      listRecords(t.db, UNRESTRICTED, {
        speciesId: f.sp.id,
        traitId: f.trait.id,
        levelId: f.biotic.id,
        secondaryReferenceId,
        limit: 10,
      });
    expect((await list(f.gift.id)).data.map((r) => r.id).sort()).toEqual(
      [f.a1.id, f.a2.id, f.a3.id].sort(),
    );
    expect((await list('none')).data.map((r) => r.id)).toEqual([f.c.id]);
  });
});

describe('RFC-63 R9, R18 every column sorts; a reference list narrows by trait and species (issue #351)', () => {
  const t = useTestDb();

  it('the records list sorts by code (EB_9 before EB_10), secondary, harmonisation and counts, paging every sort', async () => {
    const sp = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'dispersal_mode');
    const biotic = await levelByKey(t.db, trait.id, 'biotic');
    const ref = await createReference(t.db);
    const sec = await createReference(t.db, { citationKey: `Z_${randomUUID()}` });
    const batch = await createImportBatch(t.db);
    const n = randomUUID().replace(/\D/g, '').slice(0, 6);
    const make = (code: string, extra: object = {}) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        importBatchId: batch.id,
        valueText: 'biotic',
        levelId: biotic.id,
        primaryReferenceId: ref.id,
        recordCode: code,
        ...extra,
      } as Parameters<typeof createRecord>[1]);
    const ten = await make(`EB_${n}10`);
    const nine = await make(`EB_${n}9`, { secondaryReferenceId: sec.id });
    const nineB = await make(`EB_${n}9b`, { rawValue: 'b' });
    const pending = await make(`EB_${n}11`, { levelId: undefined, valueText: 'zoo' });
    const ada = (await createUser(t.db, { name: 'Ada' })).user;
    await t.db
      .insert(recordAnnotations)
      .values({ recordId: ten.id, actorId: ada.id, kind: 'confirm' });
    const ids = async (sort: string, order: 'asc' | 'desc') => {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listRecords(t.db, UNRESTRICTED, {
          speciesId: sp.id,
          traitId: trait.id,
          sort: sort as never,
          order,
          limit: 1,
          cursor,
        });
        out.push(...page.data.map((r) => r.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out;
    };
    expect(await ids('code', 'asc')).toEqual([nine.id, nineB.id, ten.id, pending.id]);
    expect(await ids('code', 'desc')).toEqual([pending.id, ten.id, nineB.id, nine.id]);
    // no secondary sorts as '' — before the Z_ reference
    expect((await ids('secondary', 'desc'))[0]).toBe(nine.id);
    expect((await ids('harmonisation', 'asc')).at(-1)).toBe(pending.id);
    expect((await ids('counts', 'desc'))[0]).toBe(ten.id);
    for (const sort of ['species', 'trait']) {
      expect((await ids(sort, 'asc')).sort()).toEqual(
        [ten.id, nine.id, nineB.id, pending.id].sort(),
      );
    }
  });

  it('a reference list takes traitId and a species-name q', async () => {
    const abies = await createSpecies(t.db, {
      canonicalName: `Abies probe${randomUUID().slice(0, 6)}`,
    });
    const betula = await createSpecies(t.db);
    const dispersal = await traitByKey(t.db, 'dispersal_mode');
    const biotic = await levelByKey(t.db, dispersal.id, 'biotic');
    const color = await traitByKey(t.db, 'flower_color');
    const blue = await levelByKey(t.db, color.id, 'blue');
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const base = { primaryReferenceId: ref.id, importBatchId: batch.id };
    const a1 = await createRecord(t.db, {
      ...base,
      speciesId: abies.id,
      traitId: dispersal.id,
      valueText: 'biotic',
      levelId: biotic.id,
    });
    const a2 = await createRecord(t.db, {
      ...base,
      speciesId: abies.id,
      traitId: color.id,
      valueText: 'blue',
      levelId: blue.id,
    });
    const b1 = await createRecord(t.db, {
      ...base,
      speciesId: betula.id,
      traitId: dispersal.id,
      valueText: 'biotic',
      levelId: biotic.id,
    });
    const list = (extra: object) =>
      listRecords(t.db, UNRESTRICTED, { referenceId: ref.id, limit: 10, ...extra });
    expect((await list({ traitId: dispersal.id })).data.map((r) => r.id).sort()).toEqual(
      [a1.id, b1.id].sort(),
    );
    expect((await list({ q: 'abies PROBE' })).data.map((r) => r.id).sort()).toEqual(
      [a1.id, a2.id].sort(),
    );
    expect((await list({ q: 'abies probe', traitId: color.id })).data.map((r) => r.id)).toEqual([
      a2.id,
    ]);
    expect((await list({ q: '100%' })).data).toEqual([]);
  });

  it('groups sort by every column under a cursor tied to its sort and order', async () => {
    const sp = await createSpecies(t.db);
    const trait = await traitByKey(t.db, 'dispersal_mode');
    const biotic = await levelByKey(t.db, trait.id, 'biotic');
    const abiotic = await levelByKey(t.db, trait.id, 'abiotic');
    const p1 = await createReference(t.db);
    const p2 = await createReference(t.db);
    const sec = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const rec = (extra: object) =>
      createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        importBatchId: batch.id,
        valueText: 'biotic',
        levelId: biotic.id,
        primaryReferenceId: p1.id,
        ...extra,
      } as Parameters<typeof createRecord>[1]);
    const g1 = await rec({ secondaryReferenceId: sec.id, createdAt: new Date('2026-01-01') });
    await rec({
      primaryReferenceId: p2.id,
      secondaryReferenceId: sec.id,
      createdAt: new Date('2026-03-01'),
    });
    const lone = await rec({
      valueText: 'abiotic',
      levelId: abiotic.id,
      createdAt: new Date('2026-02-01'),
    });
    const groups = async (sort: string, order: 'asc' | 'desc') => {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await recordGroups(t.db, UNRESTRICTED, {
          speciesId: sp.id,
          traitId: trait.id,
          sort: sort as never,
          order,
          limit: 1,
          cursor,
        });
        out.push(...page.data.map((g) => g.record?.id ?? 'pair'));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out;
    };
    expect(await groups('references', 'desc')).toEqual(['pair', lone.id]);
    expect(await groups('added', 'asc')).toEqual([lone.id, 'pair']);
    expect(await groups('value', 'asc')).toEqual([lone.id, 'pair']);
    for (const sort of ['code', 'secondary', 'origin', 'harmonisation', 'counts']) {
      expect((await groups(sort, 'asc')).sort()).toEqual(['pair', lone.id].sort());
    }
    const all = await recordGroups(t.db, UNRESTRICTED, {
      speciesId: sp.id,
      traitId: trait.id,
      limit: 10,
    });
    expect(all.data[0]).toMatchObject({
      recordCode: g1.recordCode,
      origin: 'import',
      harmonisation: 'harmonised',
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const first = await recordGroups(t.db, UNRESTRICTED, {
      speciesId: sp.id,
      traitId: trait.id,
      sort: 'added',
      order: 'asc',
      limit: 1,
    });
    await expect(
      recordGroups(t.db, UNRESTRICTED, {
        speciesId: sp.id,
        traitId: trait.id,
        sort: 'added',
        order: 'desc',
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

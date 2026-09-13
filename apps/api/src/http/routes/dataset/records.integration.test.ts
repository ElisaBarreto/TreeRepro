import type { PermissionKey } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { TestApp } from '../../../../test/helpers/app.ts';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import {
  createAcceptedValue,
  createAnnotation,
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  traitByKey,
} from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { traitLevels } from '../../../db/schema/dictionary.ts';

describe('RFC-63 R9, R10 record and summary routes', () => {
  const t = useTestApp();

  it('lists by species+trait or by reference, rejects other combinations, answers detail and summary', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
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

    const byTrait = await call(
      t.app,
      'GET',
      `/api/records?speciesId=${sp1.id}&traitId=${trait.id}`,
      { cookie },
    );
    expect(byTrait.status).toBe(200);
    expect((await byTrait.json()).data.map((r: { id: string }) => r.id)).toEqual([rec.id]);
    const byRef = await call(t.app, 'GET', `/api/records?referenceId=${ref.id}`, { cookie });
    expect((await byRef.json()).data).toHaveLength(1);
    for (const bad of [
      `/api/records?speciesId=${sp1.id}`,
      `/api/records?referenceId=${ref.id}&traitId=${trait.id}`,
      '/api/records',
    ]) {
      const res = await call(t.app, 'GET', bad, { cookie });
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error.details[0].path).toBe('speciesId');
    }
    const detail = await call(t.app, 'GET', `/api/records/${rec.id}`, { cookie });
    expect((await detail.json()).data).toMatchObject({
      id: rec.id,
      annotations: [],
      acceptedHistory: [],
      importBatch: { id: batch.id },
    });
    const missing = await call(t.app, 'GET', '/api/records/00000000-0000-7000-8000-000000000000', {
      cookie,
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('RECORD_NOT_FOUND');

    const summary = await call(t.app, 'GET', `/api/species/${sp1.id}/traits`, { cookie });
    expect(summary.status).toBe(200);
    const body = await summary.json();
    expect(body.data[0].category.key).toBe('flower_color');
    expect(body.data[0].traits[0]).toMatchObject({
      trait: { key: 'flower_color' },
      recordCount: 1,
      accepted: null,
    });
    const noSpecies = await call(
      t.app,
      'GET',
      '/api/species/00000000-0000-7000-8000-000000000000/traits',
      { cookie },
    );
    expect(noSpecies.status).toBe(404);
    expect((await noSpecies.json()).error.code).toBe('SPECIES_NOT_FOUND');
  });
});

/** A signed-in user holding exactly these permissions. */
async function scientist(
  t: TestApp,
  permissions: PermissionKey[] = ['records.create', 'dataset.read'],
) {
  const role = await createRole(t.db, { permissions });
  const { user } = await createUser(t.db, { roles: [role.id] });
  const { cookie } = await loginAs(t, user);
  return { user, cookie };
}

describe('RFC-65 R1, R2 POST /api/records', () => {
  const t = useTestApp();

  it('creates a categorical record with the level key as value_text and answers the detail', async () => {
    const { user, cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue'] });
    const ref = await createReference(t.db);
    const res = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: {
        speciesId: sp1.id,
        traitId: trait.id,
        value: { levelId: trait.levels[0]?.id },
        primaryReferenceId: ref.id,
        rawValue: 'Reds',
        note: 'Table 2',
      },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({
      speciesId: sp1.id,
      trait: { id: trait.id },
      valueText: 'red',
      level: { id: trait.levels[0]?.id, key: 'red' },
      numericValue: null,
      harmonisation: 'harmonised',
      review: 'unreviewed',
      origin: 'manual',
      createdBy: { id: user.id, name: 'Test User' },
      primaryReference: { id: ref.id },
      secondaryReference: null,
      rawValue: 'Reds',
      note: 'Table 2',
      importBatch: null,
      supersedes: null,
      supersededBy: [],
    });
  });

  it('creates a quantitative record with the canonical number as value_text', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const ref = await createReference(t.db);
    const res = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: {
        speciesId: sp1.id,
        traitId: trait.id,
        value: { numeric: 1e3 },
        primaryReferenceId: ref.id,
      },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({
      valueText: '1000',
      numericValue: 1000,
      level: null,
    });
  });

  it('validates the value against the trait: shape, foreign level, inactive level, inactive trait', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const cat = await createTrait(t.db, { levels: ['a'] });
    const other = await createTrait(t.db, { levels: ['b'] });
    const quant = await createTrait(t.db, { valueType: 'quantitative' });
    const inactiveTrait = await createTrait(t.db, { active: false, levels: ['c'] });
    const ref = await createReference(t.db);
    await t.db
      .update(traitLevels)
      .set({ active: false })
      .where(eq(traitLevels.id, other.levels[0]?.id ?? ''));
    const post = (body: Record<string, unknown>) =>
      call(t.app, 'POST', '/api/records', {
        cookie,
        body: { speciesId: sp1.id, primaryReferenceId: ref.id, ...body },
      });
    const cases: [Record<string, unknown>, string][] = [
      [{ traitId: cat.id, value: { numeric: 1 } }, 'value'],
      [{ traitId: quant.id, value: { levelId: cat.levels[0]?.id } }, 'value'],
      [{ traitId: cat.id, value: { levelId: other.levels[0]?.id } }, 'value.levelId'],
      [{ traitId: other.id, value: { levelId: other.levels[0]?.id } }, 'value.levelId'],
      [{ traitId: inactiveTrait.id, value: { levelId: inactiveTrait.levels[0]?.id } }, 'traitId'],
    ];
    for (const [body, path] of cases) {
      const res = await post(body);
      expect(res.status, path).toBe(400);
      const err = (await res.json()).error;
      expect(err.code, path).toBe('VALIDATION_FAILED');
      expect(err.details[0].path, path).toBe(path);
    }
  });

  it('answers 404 for an unknown species, trait or reference', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const zero = '00000000-0000-7000-8000-000000000000';
    const base = {
      speciesId: sp1.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id },
      primaryReferenceId: ref.id,
    };
    for (const [body, code] of [
      [{ ...base, speciesId: zero }, 'SPECIES_NOT_FOUND'],
      [{ ...base, traitId: zero }, 'TRAIT_NOT_FOUND'],
      [{ ...base, primaryReferenceId: zero }, 'REFERENCE_NOT_FOUND'],
      [{ ...base, secondaryReferenceId: zero }, 'REFERENCE_NOT_FOUND'],
    ] as const) {
      const res = await call(t.app, 'POST', '/api/records', { cookie, body });
      expect(res.status, code).toBe(404);
      expect((await res.json()).error.code, code).toBe(code);
    }
  });

  it('R2 an identical claim answers 409 RECORD_DUPLICATE naming the existing record', async () => {
    const { cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const body = {
      speciesId: sp1.id,
      traitId: trait.id,
      value: { levelId: trait.levels[0]?.id },
      primaryReferenceId: ref.id,
      rawValue: 'A',
    };
    const first = await call(t.app, 'POST', '/api/records', { cookie, body });
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.id;
    const again = await call(t.app, 'POST', '/api/records', { cookie, body });
    expect(again.status).toBe(409);
    const err = (await again.json()).error;
    expect(err.code).toBe('RECORD_DUPLICATE');
    expect(err.details).toEqual([{ path: 'recordId', message: firstId }]);
    // a different raw value is a different claim
    const other = await call(t.app, 'POST', '/api/records', {
      cookie,
      body: { ...body, rawValue: 'a.' },
    });
    expect(other.status).toBe(201);
  });

  it('RFC-63 R8 the detail shows supersedes and supersededBy', async () => {
    const { user, cookie } = await scientist(t);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const batch = await createImportBatch(t.db);
    const pending = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'aa',
      primaryReferenceId: ref.id,
      importBatchId: batch.id,
    });
    const mapped = await createRecord(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
      supersedesRecordId: pending.id,
    });
    const original = await call(t.app, 'GET', `/api/records/${pending.id}`, { cookie });
    expect((await original.json()).data).toMatchObject({
      supersedes: null,
      supersededBy: [{ id: mapped.id }],
    });
    const reading = await call(t.app, 'GET', `/api/records/${mapped.id}`, { cookie });
    expect((await reading.json()).data).toMatchObject({
      supersedes: { id: pending.id },
      supersededBy: [],
    });
  });
});

describe('RFC-65 R7–R9 harmonisation queue', () => {
  const t = useTestApp();

  /** Two species, one reference, a categorical trait (red, blue) and a quantitative one; pending import rows on both. */
  async function queueFixture() {
    const { user, cookie } = await scientist(t, ['records.create', 'dataset.read']);
    const s1 = await createSpecies(t.db);
    const s2 = await createSpecies(t.db);
    const ref = await createReference(t.db);
    const cat = await createTrait(t.db, { levels: ['red', 'blue'] });
    const quant = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const batch = await createImportBatch(t.db);
    const imp = (
      speciesId: string,
      traitId: string,
      valueText: string,
      extra: Record<string, unknown> = {},
    ) =>
      createRecord(t.db, {
        speciesId,
        traitId,
        valueText,
        primaryReferenceId: ref.id,
        importBatchId: batch.id,
        harmonisation: 'unknown_level',
        ...extra,
      });
    const reds1 = await imp(s1.id, cat.id, 'reds', { rawValue: 'Reds' });
    const reds2 = await imp(s2.id, cat.id, 'reds');
    const reds3 = await imp(s2.id, cat.id, 'reds', { rawValue: 'reds!' });
    const multi = await imp(s1.id, cat.id, 'red;blue', { harmonisation: 'multi_value' });
    await imp(s1.id, cat.id, '', { harmonisation: 'empty' });
    const approx = await imp(s1.id, quant.id, 'ca. 12', { harmonisation: 'not_numeric' });
    return { user, cookie, s1, s2, ref, cat, quant, reds1, reds2, reds3, multi, approx };
  }

  it('R7, R8 lists traits with pending counts and the groups of one trait; empty rows are not pending', async () => {
    const f = await queueFixture();
    const traitsRes = await call(t.app, 'GET', '/api/records/pending/traits', { cookie: f.cookie });
    expect(traitsRes.status).toBe(200);
    const traits = (await traitsRes.json()).data as {
      trait: { id: string; key: string };
      count: number;
    }[];
    expect(traits.find((x) => x.trait.id === f.cat.id)).toMatchObject({
      trait: { key: f.cat.key, valueType: 'categorical' },
      count: 4,
    });
    expect(traits.find((x) => x.trait.id === f.quant.id)).toMatchObject({ count: 1 });
    const groups = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}`, {
      cookie: f.cookie,
    });
    expect(groups.status).toBe(200);
    expect((await groups.json()).data).toEqual([
      { valueText: 'reds', harmonisation: 'unknown_level', count: 3, sampleRecordId: f.reds3.id },
      { valueText: 'red;blue', harmonisation: 'multi_value', count: 1, sampleRecordId: f.multi.id },
    ]);
    const page1 = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}&limit=1`, {
      cookie: f.cookie,
    });
    const body1 = await page1.json();
    expect(body1.data[0].valueText).toBe('reds');
    expect(body1.meta.nextCursor).not.toBeNull();
    const page2 = await call(
      t.app,
      'GET',
      `/api/records/pending?traitId=${f.cat.id}&limit=1&cursor=${body1.meta.nextCursor}`,
      { cookie: f.cookie },
    );
    const body2 = await page2.json();
    expect(body2.data[0].valueText).toBe('red;blue');
    expect(body2.meta.nextCursor).toBeNull();
    const bad = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}&cursor=nope`, {
      cookie: f.cookie,
    });
    expect(bad.status).toBe(400);
    const noTrait = await call(t.app, 'GET', '/api/records/pending', { cookie: f.cookie });
    expect(noTrait.status).toBe(400);
    const unknown = await call(
      t.app,
      'GET',
      '/api/records/pending?traitId=00000000-0000-7000-8000-000000000000',
      { cookie: f.cookie },
    );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('TRAIT_NOT_FOUND');
  });

  it('R9 maps a group to one level: one harmonised record per pending row, inheriting references and raw value', async () => {
    const f = await queueFixture();
    const red = f.cat.levels[0]?.id ?? '';
    const res = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: {
        traitId: f.cat.id,
        valueText: 'reds',
        value: { levelIds: [red] },
        note: 'Plural of red',
      },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ created: 3, skipped: 0 });
    const original = await call(t.app, 'GET', `/api/records/${f.reds1.id}`, { cookie: f.cookie });
    const detail = (await original.json()).data;
    expect(detail.supersededBy).toHaveLength(1);
    expect(detail.review).toBe('unreviewed');
    const mapped = await call(t.app, 'GET', `/api/records/${detail.supersededBy[0].id}`, {
      cookie: f.cookie,
    });
    expect((await mapped.json()).data).toMatchObject({
      speciesId: f.s1.id,
      valueText: 'red',
      level: { id: red, key: 'red' },
      harmonisation: 'harmonised',
      origin: 'manual',
      createdBy: { id: f.user.id },
      primaryReference: { id: f.ref.id },
      rawValue: 'Reds',
      note: 'Plural of red',
      supersedes: { id: f.reds1.id },
    });
    const noRaw = await call(t.app, 'GET', `/api/records/${f.reds2.id}`, { cookie: f.cookie });
    const noRawMapped = await call(
      t.app,
      'GET',
      `/api/records/${(await noRaw.json()).data.supersededBy[0].id}`,
      { cookie: f.cookie },
    );
    expect((await noRawMapped.json()).data.rawValue).toBe('reds');
    const groups = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}`, {
      cookie: f.cookie,
    });
    expect((await groups.json()).data.map((g: { valueText: string }) => g.valueText)).toEqual([
      'red;blue',
    ]);
    const again = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.cat.id, valueText: 'reds', value: { levelIds: [red] } },
    });
    expect((await again.json()).data).toEqual({ created: 0, skipped: 0 });
  });

  it('R9 a multi-value group maps to several levels; a numeric group maps to a number; existing claims are skipped', async () => {
    const f = await queueFixture();
    const [red, blue] = f.cat.levels.map((l) => l.id);
    const multi = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.cat.id, valueText: 'red;blue', value: { levelIds: [red, blue] } },
    });
    expect((await multi.json()).data).toEqual({ created: 2, skipped: 0 });
    const original = await call(t.app, 'GET', `/api/records/${f.multi.id}`, { cookie: f.cookie });
    expect((await original.json()).data.supersededBy).toHaveLength(2);
    const numeric = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.quant.id, valueText: 'ca. 12', value: { numeric: 12 } },
    });
    expect((await numeric.json()).data).toEqual({ created: 1, skipped: 0 });
    const approx = await call(t.app, 'GET', `/api/records/${f.approx.id}`, { cookie: f.cookie });
    const reading = await call(
      t.app,
      'GET',
      `/api/records/${(await approx.json()).data.supersededBy[0].id}`,
      { cookie: f.cookie },
    );
    expect((await reading.json()).data).toMatchObject({
      valueText: '12',
      numericValue: 12,
      rawValue: 'ca. 12',
    });
    // a claim the spreadsheet had already harmonised: (s2, cat, 'red', raw 'reds!', ref) exists → the mapping skips it
    await createRecord(t.db, {
      speciesId: f.s2.id,
      traitId: f.cat.id,
      valueText: 'red',
      levelId: red,
      rawValue: 'reds!',
      primaryReferenceId: f.ref.id,
      importBatchId: (await createImportBatch(t.db)).id,
    });
    const skipped = await call(t.app, 'POST', '/api/records/pending/map', {
      cookie: f.cookie,
      body: { traitId: f.cat.id, valueText: 'reds', value: { levelIds: [red] } },
    });
    expect((await skipped.json()).data).toEqual({ created: 2, skipped: 1 });
    const groups = await call(t.app, 'GET', `/api/records/pending?traitId=${f.cat.id}`, {
      cookie: f.cookie,
    });
    expect((await groups.json()).data).toEqual([
      { valueText: 'reds', harmonisation: 'unknown_level', count: 1, sampleRecordId: f.reds3.id },
    ]);
  });

  it('R9 validates like a manual record: level of another trait, levels on a quantitative trait, unknown trait', async () => {
    const f = await queueFixture();
    const other = await createTrait(t.db, { levels: ['x'] });
    const post = (body: Record<string, unknown>) =>
      call(t.app, 'POST', '/api/records/pending/map', { cookie: f.cookie, body });
    const foreign = await post({
      traitId: f.cat.id,
      valueText: 'reds',
      value: { levelIds: [other.levels[0]?.id] },
    });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error.details[0].path).toBe('value.levelId');
    const shape = await post({
      traitId: f.quant.id,
      valueText: 'ca. 12',
      value: { levelIds: [f.cat.levels[0]?.id] },
    });
    expect(shape.status).toBe(400);
    expect((await shape.json()).error.details[0].path).toBe('value');
    const unknown = await post({
      traitId: '00000000-0000-7000-8000-000000000000',
      valueText: 'reds',
      value: { numeric: 1 },
    });
    expect(unknown.status).toBe(404);
  });
});

describe('RFC-65 R10 GET /api/records/disputed', () => {
  const t = useTestApp();

  const idsOf = async (cookie: string) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await call(
        t.app,
        'GET',
        `/api/records/disputed?limit=200${cursor ? `&cursor=${cursor}` : ''}`,
        { cookie },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      ids.push(...body.data.map((r: { id: string }) => r.id));
      cursor = body.meta.nextCursor;
    } while (cursor);
    return ids;
  };

  it('lists standing disputes newest first, drops them after a later accepted decision for the species and trait or a changed stance, never withdrawn records', async () => {
    const author = await scientist(t, ['records.annotate', 'dataset.read']);
    const b = await scientist(t, ['records.annotate']);
    const sp1 = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['a', 'b'] });
    const ref = await createReference(t.db);
    const mk = (i: number) =>
      createRecord(t.db, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: ['a', 'b'][i] ?? 'a',
        levelId: trait.levels[i]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: author.user.id,
      });
    const older = await mk(0);
    const newer = await mk(1);
    await createAnnotation(t.db, {
      recordId: older.id,
      actorId: b.user.id,
      kind: 'dispute',
      note: 'Older claim wrong',
    });
    await createAnnotation(t.db, {
      recordId: newer.id,
      actorId: b.user.id,
      kind: 'dispute',
      note: 'Newer claim wrong',
    });
    let ids = await idsOf(author.cookie);
    expect(ids).toContain(newer.id);
    expect(ids).toContain(older.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    const first = await call(t.app, 'GET', '/api/records/disputed?limit=200', {
      cookie: author.cookie,
    });
    const item = (await first.json()).data.find((r: { id: string }) => r.id === newer.id);
    expect(item).toMatchObject({
      review: 'disputed',
      latestDispute: { actor: { id: b.user.id, name: 'Test User' }, note: 'Newer claim wrong' },
    });
    // a curator decides after both standing disputes: the decision retires them both
    // (RFC-65 R10 is scoped to the species x trait, not to the decided record)
    await createAcceptedValue(t.db, {
      speciesId: sp1.id,
      traitId: trait.id,
      recordId: newer.id,
      actorId: author.user.id,
    });
    ids = await idsOf(author.cookie);
    expect(ids).not.toContain(newer.id);
    expect(ids).not.toContain(older.id);
    // a new dispute after the decision brings its record back
    await createAnnotation(t.db, {
      recordId: newer.id,
      actorId: b.user.id,
      kind: 'dispute',
      note: 'Still wrong',
    });
    expect(await idsOf(author.cookie)).toContain(newer.id);
    await createAnnotation(t.db, {
      recordId: older.id,
      actorId: b.user.id,
      kind: 'dispute',
      note: 'Older still wrong',
    });
    expect(await idsOf(author.cookie)).toContain(older.id);
    // the disputer steps back: gone
    await createAnnotation(t.db, { recordId: newer.id, actorId: b.user.id, kind: 'neutral' });
    expect(await idsOf(author.cookie)).not.toContain(newer.id);
    // withdrawn records never appear
    await createAnnotation(t.db, {
      recordId: older.id,
      actorId: author.user.id,
      kind: 'withdraw',
      note: 'Retracted',
    });
    expect(await idsOf(author.cookie)).not.toContain(older.id);
    const bad = await call(t.app, 'GET', '/api/records/disputed?cursor=nope', {
      cookie: author.cookie,
    });
    expect(bad.status).toBe(400);
  });
});

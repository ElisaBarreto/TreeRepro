import { randomBytes } from 'node:crypto';
import type { Platform } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, TEST_PLANT_ORIGIN, useTestApp } from '../../test/helpers/app.ts';
import {
  addPlotSpecies,
  createContest,
  createFamily,
  createGenus,
  createImportBatch,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { withRollback } from '../../test/helpers/db.ts';
import { unzip } from '../../test/helpers/export.ts';
import { adminRoleId } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';
import { speciesCountsByTrait } from '../dataset/dictionary.ts';
import { countContested, countPendingGroups } from '../dataset/queues.ts';
import { speciesNames } from '../db/schema/taxa.ts';
import { computeDatasetStats, dashboardKeys } from '../workspace/dashboard.ts';
import { viewerClass } from './visibility.ts';

const tag = () => randomBytes(4).toString('hex');

/**
 * RFC-33 R2, R5, R9: TreeRepro shows reviewed trees only, PlantRepro every
 * species. One fixture per test — a reviewed tree, a reviewed not_tree and a
 * proposed tree in a family, genus and trait of their own, so every cached
 * figure keyed by them is fresh — read through every reading route on both hosts.
 */
describe('RFC-33 R2, R5, R9 visibility per platform', () => {
  const t = useTestApp();

  async function scene() {
    const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const trait = await createTrait(t.db, { levels: ['one'] });
    const reference = await createReference(t.db);
    const name = tag();
    const make = async (label: string, plantType: 'tree' | 'not_tree', reviewed: boolean) => {
      const sp = await createSpecies(t.db, {
        canonicalName: `Scopus ${label}-${name}`,
        genusId: genus.id,
        plantType,
        plantTypeStatus: reviewed ? 'reviewed' : 'proposed',
      });
      const record = await createRecord(t.db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'one',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy: user.id,
      });
      return { ...sp, recordId: record.id };
    };
    const tree = await make('arbor', 'tree', true);
    const herb = await make('herba', 'not_tree', true);
    const proposed = await make('propositus', 'tree', false);
    const sessions = {
      treerepro: (await loginAs(t, user, { platform: 'treerepro' })).cookie,
      plantrepro: (await loginAs(t, user, { platform: 'plantrepro' })).cookie,
    };
    const on = (platform: Platform) => (method: string, path: string, body?: unknown) =>
      call(t.app, method, platform === 'plantrepro' ? `http://plantrepro.localhost${path}` : path, {
        cookie: sessions[platform],
        origin: platform === 'plantrepro' ? TEST_PLANT_ORIGIN : undefined,
        body,
      });
    return { user, family, genus, trait, reference, name, tree, herb, proposed, on };
  }

  it('lists, details, counts, coverage, contributions and the export omit the hidden species on TreeRepro only', async () => {
    const s = await scene();
    const hidden = [s.herb, s.proposed];
    const all = [s.tree, ...hidden];

    for (const platform of ['treerepro', 'plantrepro'] as const) {
      const send = s.on(platform);
      const shown = platform === 'treerepro' ? [s.tree] : all;
      const absent = platform === 'treerepro' ? hidden : [];
      const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

      const list = await send('GET', `/api/species?q=${s.name}&scope=all`);
      expect(list.status).toBe(200);
      expect(ids((await list.json()).data)).toEqual(ids(shown));

      const count = await send('GET', `/api/species/count?q=${s.name}&scope=all`);
      expect((await count.json()).data.count).toBe(shown.length);

      for (const sp of all) {
        const expected = shown.includes(sp) ? 200 : 404;
        expect((await send('GET', `/api/species/${sp.id}`)).status).toBe(expected);
        expect((await send('GET', `/api/species/${sp.id}/traits`)).status).toBe(expected);
        const records = await send('GET', `/api/records?speciesId=${sp.id}&traitId=${s.trait.id}`);
        expect(records.status === 200 ? (await records.json()).data.length : 0).toBe(
          shown.includes(sp) ? 1 : 0,
        );
        expect((await send('GET', `/api/records/${sp.recordId}`)).status).toBe(expected);
      }

      const traitSpecies = await send('GET', `/api/traits/${s.trait.id}/species?scope=all`);
      expect(ids((await traitSpecies.json()).data)).toEqual(ids(shown));

      const traitPage = await send('GET', `/api/traits/${s.trait.id}`);
      expect((await traitPage.json()).data.speciesWithData).toBe(shown.length);

      // The dictionary's counts are the same globalSpeciesVisible scan behind a
      // ten-minute key every test shares, so a fresh trait reads 0 there until
      // it expires (RFC-62 R5); the trait page above is keyed by this trait.

      const genera = await send('GET', `/api/genera?q=${encodeURIComponent(s.genus.name)}`);
      expect((await genera.json()).data.map((g: { id: string }) => g.id)).toEqual([s.genus.id]);

      const coverage = await send('GET', `/api/coverage?familyId=${s.family.id}`);
      expect(coverage.status).toBe(200);
      const byTrait = (await coverage.json()).data.byTrait.find(
        (r: { trait: { id: string } }) => r.trait.id === s.trait.id,
      );
      expect(byTrait.withData).toBe(shown.length);

      const reference = await send('GET', `/api/records?referenceId=${s.reference.id}`);
      expect(
        (await reference.json()).data.map((r: { species: { id: string } }) => r.species.id).sort(),
      ).toEqual(ids(shown));

      const contributions = await send('GET', '/api/me/contributions?kind=records');
      const mine = (await contributions.json()).data.map(
        (r: { species: { id: string } }) => r.species.id,
      );
      for (const sp of shown) expect(mine).toContain(sp.id);
      for (const sp of absent) expect(mine).not.toContain(sp.id);

      const zip = await send('GET', '/api/export/dataset.zip');
      expect(zip.status).toBe(200);
      const records = (await unzip(await zip.arrayBuffer())).get('records.csv') ?? '';
      for (const sp of shown) expect(records).toContain(sp.canonicalName);
      for (const sp of absent) expect(records).not.toContain(sp.canonicalName);
    }
  });

  it('R3 families and genera whose species are all hidden are omitted on TreeRepro, even for an admin; empty ones stay listed', async () => {
    const s = await scene();
    const hiddenFamily = await createFamily(t.db);
    const hiddenGenus = await createGenus(t.db, { familyId: hiddenFamily.id });
    await createSpecies(t.db, { genusId: hiddenGenus.id, plantType: 'not_tree' });
    await createSpecies(t.db, { genusId: hiddenGenus.id, plantTypeStatus: 'proposed' });
    const emptyFamily = await createFamily(t.db);
    const emptyGenus = await createGenus(t.db, { familyId: emptyFamily.id });

    for (const platform of ['treerepro', 'plantrepro'] as const) {
      const send = s.on(platform);
      const genusIds = async (name: string) =>
        (await (await send('GET', `/api/genera?q=${encodeURIComponent(name)}`)).json()).data.map(
          (g: { id: string }) => g.id,
        );
      expect(await genusIds(hiddenGenus.name)).toEqual(
        platform === 'treerepro' ? [] : [hiddenGenus.id],
      );
      expect(await genusIds(emptyGenus.name)).toEqual([emptyGenus.id]);
      expect(await genusIds(s.genus.name)).toEqual([s.genus.id]);

      const familyIds: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await send(
          'GET',
          `/api/families?limit=200${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        familyIds.push(...body.data.map((f: { id: string }) => f.id));
        cursor = body.meta.nextCursor;
      } while (cursor);
      expect(familyIds).toContain(s.family.id);
      expect(familyIds).toContain(emptyFamily.id);
      if (platform === 'treerepro') expect(familyIds).not.toContain(hiddenFamily.id);
      else expect(familyIds).toContain(hiddenFamily.id);
    }
  });

  it("the dictionary's species counts and the pending and contested queues omit the hidden species on TreeRepro only", async () => {
    const s = await scene();
    const all = [s.tree, s.herb, s.proposed];
    const level = s.trait.levels[0]?.id as string;
    const pendingTrait = await createTrait(t.db, { levels: ['one'] });
    const batch = await createImportBatch(t.db);
    const pendingReference = await createReference(t.db);
    const contests = new Map<string, string>();
    for (const sp of all) {
      await createRecord(t.db, {
        speciesId: sp.id,
        traitId: pendingTrait.id,
        valueText: 'stray',
        primaryReferenceId: pendingReference.id,
        importBatchId: batch.id,
        harmonisation: 'unknown_level',
      });
      const contest = await createContest(t.db, {
        speciesId: sp.id,
        traitId: s.trait.id,
        createdBy: s.user.id,
        levelIds: [level],
      });
      contests.set(contest.id, sp.id);
    }

    // RFC-62 R5: one cache entry per platform. Forget both, then read them back
    // to back, so an entry shared by the platforms would answer the same count.
    const viewer = (platform: Platform) => ({ inactive: true, plotIds: null, platform });
    await t.redis.del(
      `dictionary:species-counts:${viewerClass(viewer('treerepro'))}`,
      `dictionary:species-counts:${viewerClass(viewer('plantrepro'))}`,
    );
    const ctx = { db: t.db, redis: t.redis };
    expect((await speciesCountsByTrait(ctx, viewer('treerepro'))).get(s.trait.id)).toBe(1);
    expect((await speciesCountsByTrait(ctx, viewer('plantrepro'))).get(s.trait.id)).toBe(3);

    for (const platform of ['treerepro', 'plantrepro'] as const) {
      const send = s.on(platform);
      const shown = platform === 'treerepro' ? [s.tree.id] : all.map((sp) => sp.id);

      const traits = (await (await send('GET', '/api/records/pending/traits')).json()).data;
      expect(
        traits.find((r: { trait: { id: string } }) => r.trait.id === pendingTrait.id),
      ).toMatchObject({ count: shown.length });
      const groups = await send('GET', `/api/records/pending?traitId=${pendingTrait.id}`);
      expect((await groups.json()).data).toMatchObject([
        { valueText: 'stray', count: shown.length },
      ]);

      const standing: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await send(
          'GET',
          `/api/records/disputed?limit=200${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        for (const item of body.data as { id: string }[]) {
          const speciesId = contests.get(item.id);
          if (speciesId) standing.push(speciesId);
        }
        cursor = body.meta.nextCursor;
      } while (cursor);
      expect(standing.sort()).toEqual([...shown].sort());
    }
  });

  it('on TreeRepro a write naming a hidden species answers 404 and changes nothing', async () => {
    const s = await scene();
    const tree = s.on('treerepro');
    const plant = s.on('plantrepro');
    const level = s.trait.levels[0]?.id as string;

    const record = (speciesId: string) => ({
      speciesId,
      traitId: s.trait.id,
      value: { levelIds: [level] },
      sources: { personalObservation: true },
    });
    const plot = await createPlot(t.db);
    // A member already, so removing it would succeed if the platform were ignored.
    const member = await createPlot(t.db);
    await addPlotSpecies(t.db, member.id, [s.herb.id, s.proposed.id]);
    for (const sp of [s.herb, s.proposed]) {
      const contest = await createContest(t.db, {
        speciesId: sp.id,
        traitId: s.trait.id,
        createdBy: s.user.id,
        levelIds: [level],
      });
      const writes: [string, string, unknown][] = [
        ['POST', `/api/plots/${plot.id}/species`, { speciesId: sp.id }],
        ['DELETE', `/api/plots/${member.id}/species/${sp.id}`, undefined],
        ['POST', `/api/contests/${contest.id}/resolve`, {}],
        ['POST', `/api/contests/${contest.id}/withdraw`, {}],
        ['POST', '/api/records', record(sp.id)],
        ['PATCH', `/api/species/${sp.id}`, { active: false }],
        ['POST', `/api/species/${sp.id}/names`, { name: `Alius ${tag()}`, nameType: 'synonym' }],
        ['POST', `/api/species/${sp.id}/plant-type`, { plantType: 'tree' }],
        ['POST', `/api/species/${sp.id}/traits/${s.trait.id}/levels/${level}/withdraw`, {}],
        ['POST', `/api/records/${sp.recordId}/annotations`, { kind: 'confirm' }],
      ];
      for (const [method, path, body] of writes) {
        const res = await tree(method, path, body);
        expect([path, res.status]).toEqual([path, 404]);
      }
      // The same species is reachable on PlantRepro, and unchanged.
      const members = await plant('GET', `/api/plots/${member.id}/species`);
      expect((await members.json()).data.map((m: { id: string }) => m.id)).toContain(sp.id);
      const detail = await plant('GET', `/api/species/${sp.id}`);
      expect((await detail.json()).data).toMatchObject({ active: true, names: [] });
    }

    // A tree is written to on both hosts, and the write shows on the other.
    const added = await plant('POST', `/api/species/${s.tree.id}/names`, {
      name: `Arbor alia ${tag()}`,
      nameType: 'synonym',
    });
    expect(added.status).toBe(201);
    const seen = await tree('GET', `/api/species/${s.tree.id}`);
    expect((await seen.json()).data.names).toHaveLength(1);
  });

  it('RFC-60 R13 on TreeRepro a name a hidden species holds is refused with no link; on PlantRepro it is the usual collision', async () => {
    const s = await scene();
    const tree = s.on('treerepro');
    const synonym = `Herba synonyma ${tag()}`;
    await t.db.insert(speciesNames).values({
      speciesId: s.herb.id,
      name: synonym,
      nameType: 'synonym',
      source: 'manual',
    });
    const refused = (res: Response) => async () => {
      expect(res.status).toBe(409);
      const { error } = await res.json();
      expect(error.code).toBe('SPECIES_NAME_TAKEN');
      expect(error.message).toMatch(/not classified as a tree on TreeRepro/);
      expect(error.details).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain(s.herb.id);
    };
    // The approval of a proposal made before the species was hidden refuses it too (RFC-75 R4).
    const open = await tree('POST', '/api/species/proposals', { name: `Herba futura ${tag()}` });
    const proposalId = (await open.json()).data.id;
    await refused(
      await tree('POST', `/api/species/proposals/${proposalId}/approve`, {
        canonicalName: s.herb.canonicalName,
        nameSource: 'original',
      }),
    )();
    await refused(
      await tree('POST', `/api/species/proposals/${proposalId}/approve`, {
        canonicalName: `Arbor nova ${tag()}`,
        nameSource: 'original',
        alternativeNames: [{ name: synonym, nameType: 'synonym' }],
      }),
    )();
    for (const name of [s.herb.canonicalName, synonym.toUpperCase(), s.proposed.canonicalName]) {
      await refused(await tree('POST', '/api/species/proposals', { name }))();
      await refused(
        await tree('POST', '/api/species', { canonicalName: name, nameSource: 'original' }),
      )();
      await refused(
        await tree('POST', `/api/species/${s.tree.id}/names`, { name, nameType: 'synonym' }),
      )();
    }
    // A visible species keeps the answer that links to it (RFC-75 R2).
    const visible = await tree('POST', '/api/species/proposals', { name: s.tree.canonicalName });
    expect((await visible.json()).error.details).toEqual([{ path: 'name', message: s.tree.id }]);
    // On PlantRepro nothing is hidden: the proposal links to the species.
    const plant = await s.on('plantrepro')('POST', '/api/species/proposals', {
      name: s.herb.canonicalName,
      plantType: 'not_tree',
    });
    expect((await plant.json()).error.details).toEqual([{ path: 'name', message: s.herb.id }]);
  });
});

describe("RFC-72 R1 the dataset counts are the platform's", () => {
  const t = useTestApp();

  it('computeDatasetStats counts a non-tree and its records on PlantRepro only', async () => {
    await withRollback(t.db, async (tx) => {
      // Sibling files create species meanwhile: compare inside one snapshot.
      await tx.execute(sql`set transaction isolation level repeatable read`);
      const before = {
        tree: await computeDatasetStats(tx, 'treerepro'),
        plant: await computeDatasetStats(tx, 'plantrepro'),
      };
      const { user } = await createUser(tx);
      const trait = await createTrait(tx, { levels: ['one'] });
      const herb = await createSpecies(tx, { plantType: 'not_tree' });
      await createRecord(tx, {
        speciesId: herb.id,
        traitId: trait.id,
        valueText: 'one',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: (await createReference(tx)).id,
        origin: 'manual',
        createdBy: user.id,
      });
      const tree = await computeDatasetStats(tx, 'treerepro');
      const plant = await computeDatasetStats(tx, 'plantrepro');
      expect(tree.speciesCount).toBe(before.tree.speciesCount);
      expect(tree.recordCount).toBe(before.tree.recordCount);
      expect(plant.speciesCount).toBe(before.plant.speciesCount + 1);
      expect(plant.recordCount).toBe(before.plant.recordCount + 1);
    });
  });

  it("the dashboard's pending and contested counts count a non-tree on PlantRepro only", async () => {
    await withRollback(t.db, async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      const viewer = (platform: Platform) => ({ inactive: true, plotIds: null, platform });
      const counts = async (platform: Platform) => ({
        pending: await countPendingGroups(tx, viewer(platform)),
        contested: await countContested(tx, viewer(platform)),
      });
      const before = { tree: await counts('treerepro'), plant: await counts('plantrepro') };
      const { user } = await createUser(tx);
      const trait = await createTrait(tx, { levels: ['one'] });
      const herb = await createSpecies(tx, { plantType: 'not_tree' });
      await createRecord(tx, {
        speciesId: herb.id,
        traitId: trait.id,
        valueText: 'stray',
        primaryReferenceId: (await createReference(tx)).id,
        importBatchId: (await createImportBatch(tx)).id,
        harmonisation: 'unknown_level',
      });
      // A contest stands against a level the species has a record for.
      await createRecord(tx, {
        speciesId: herb.id,
        traitId: trait.id,
        valueText: 'one',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: (await createReference(tx)).id,
        origin: 'manual',
        createdBy: user.id,
      });
      await createContest(tx, {
        speciesId: herb.id,
        traitId: trait.id,
        createdBy: user.id,
        levelIds: [trait.levels[0]?.id as string],
      });
      expect(await counts('treerepro')).toEqual(before.tree);
      expect(await counts('plantrepro')).toEqual({
        pending: before.plant.pending + 1,
        contested: before.plant.contested + 1,
      });
    });
  });

  it("a write drops the viewer's dashboard entry on both platforms", () => {
    expect(dashboardKeys('u-1')).toEqual(['dashboard:treerepro:u-1', 'dashboard:plantrepro:u-1']);
  });
});

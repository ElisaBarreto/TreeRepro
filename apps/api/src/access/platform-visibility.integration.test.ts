import { randomBytes } from 'node:crypto';
import type { Platform } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, TEST_PLANT_ORIGIN, useTestApp } from '../../test/helpers/app.ts';
import {
  createFamily,
  createGenus,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { unzip } from '../../test/helpers/export.ts';
import { adminRoleId } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';

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

      const dictionary = await send('GET', `/api/traits?q=${s.trait.key}`);
      const entry = (await dictionary.json()).data
        .flatMap((c: { traits: { id: string; speciesCount: number }[] }) => c.traits)
        .find((x: { id: string }) => x.id === s.trait.id);
      expect(entry.speciesCount).toBe(shown.length);

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
    for (const sp of [s.herb, s.proposed]) {
      const writes: [string, string, unknown][] = [
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
});

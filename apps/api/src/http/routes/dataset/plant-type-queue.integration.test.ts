import { randomBytes } from 'node:crypto';
import type { PermissionKey, Platform } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, TEST_PLANT_ORIGIN, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import { createFamily, createGenus, createSpecies } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { speciesProposals } from '../../../db/schema/proposals.ts';
import { species } from '../../../db/schema/taxa.ts';

const tag = () => randomBytes(4).toString('hex');

/** RFC-65 R20, RFC-33 R11: the plant-type review queue, on both platforms. */
describe('RFC-65 R20 plant-type review queue', () => {
  const t = useTestApp();

  async function actor(platform: Platform, permissions: PermissionKey[]) {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id], platform, name: 'Rev Iewer' });
    const { cookie } = await loginAs(t, user, { platform });
    const host = platform === 'plantrepro' ? 'http://plantrepro.localhost' : '';
    const origin = platform === 'plantrepro' ? TEST_PLANT_ORIGIN : undefined;
    return {
      user,
      send: (method: string, path: string, body?: unknown) =>
        call(t.app, method, `${host}${path}`, { cookie, body, origin }),
    };
  }

  /** Every page of the queue, as ids. */
  async function queueIds(send: (m: string, p: string) => Promise<Response>) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const res: Response = await send(
        'GET',
        `/api/curation/plant-types?limit=200${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      ids.push(...body.data.map((i: { id: string }) => i.id));
      cursor = body.meta.nextCursor;
    } while (cursor);
    return ids;
  }

  const REVIEW: PermissionKey[] = ['dataset.read', 'records.review'];

  it('a TreeRepro manager lists and confirms a proposed species; its page stays 404 there until it is a reviewed tree', async () => {
    const manager = await actor('treerepro', REVIEW);
    const { user: proposer } = await createUser(t.db, { name: 'Pro Poser' });
    const family = await createFamily(t.db);
    const genus = await createGenus(t.db, { familyId: family.id });
    const herb = await createSpecies(t.db, {
      canonicalName: `Herba proposita-${tag()}`,
      genusId: genus.id,
      plantType: 'not_tree',
      plantTypeStatus: 'proposed',
    });
    const tree = await createSpecies(t.db, {
      canonicalName: `Arbor proposita-${tag()}`,
      plantTypeStatus: 'proposed',
    });
    await t.db.update(species).set({ createdBy: proposer.id }).where(eq(species.id, herb.id));
    await t.db.insert(speciesProposals).values({
      proposedName: herb.canonicalName,
      note: 'Seen in the field',
      plantType: 'not_tree',
      status: 'approved',
      speciesId: herb.id,
      proposerId: proposer.id,
      decidedBy: proposer.id,
      decidedAt: new Date(),
    });
    const reviewed = await createSpecies(t.db);

    const ids = await queueIds(manager.send);
    expect(ids).toEqual(expect.arrayContaining([herb.id, tree.id]));
    expect(ids).not.toContain(reviewed.id);
    // Oldest first.
    expect(ids.indexOf(herb.id)).toBeLessThan(ids.indexOf(tree.id));

    const first = await manager.send('GET', '/api/curation/plant-types?limit=200');
    const item = (await first.json()).data.find((i: { id: string }) => i.id === herb.id);
    expect(item).toEqual({
      id: herb.id,
      canonicalName: herb.canonicalName,
      genus: { id: genus.id, name: genus.name },
      family: { id: family.id, name: family.name },
      plantType: 'not_tree',
      createdBy: { id: proposer.id, name: 'Pro Poser' },
      createdAt: expect.any(String),
      note: 'Seen in the field',
    });

    // The queue is the exception: the species page is still hidden here.
    expect((await manager.send('GET', `/api/species/${tree.id}`)).status).toBe(404);

    // Confirm, unchanged type: a reviewed tree, now on TreeRepro.
    const confirmed = await manager.send('POST', `/api/species/${tree.id}/plant-type/confirm`, {});
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).data).toEqual({
      id: tree.id,
      plantType: 'tree',
      plantTypeStatus: 'reviewed',
    });
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: tree.id }))?.metadata).toEqual({
      kind: 'species',
      fields: ['plantType'],
      from: { plantType: 'tree', plantTypeStatus: 'proposed' },
      to: { plantType: 'tree', plantTypeStatus: 'reviewed' },
    });
    expect((await manager.send('GET', `/api/species/${tree.id}`)).status).toBe(200);

    // Change type and confirm: the herb becomes a reviewed not-tree, still hidden here.
    const changed = await manager.send('POST', `/api/species/${herb.id}/plant-type/confirm`, {
      plantType: 'not_tree',
    });
    expect((await changed.json()).data).toMatchObject({ plantTypeStatus: 'reviewed' });
    expect((await manager.send('GET', `/api/species/${herb.id}`)).status).toBe(404);

    const after = await queueIds(manager.send);
    expect(after).not.toContain(herb.id);
    expect(after).not.toContain(tree.id);

    // A reviewed species outside the scope is not the queue's: 404, unchanged.
    const again = await manager.send('POST', `/api/species/${herb.id}/plant-type/confirm`, {
      plantType: 'tree',
    });
    expect(again.status).toBe(404);
    expect((await again.json()).error.code).toBe('SPECIES_NOT_FOUND');
  });

  it('a PlantRepro manager sees the same queue and may turn a proposed species into a tree', async () => {
    const manager = await actor('plantrepro', REVIEW);
    const herb = await createSpecies(t.db, {
      plantType: 'not_tree',
      plantTypeStatus: 'proposed',
    });
    expect(await queueIds(manager.send)).toContain(herb.id);
    const changed = await manager.send('POST', `/api/species/${herb.id}/plant-type/confirm`, {
      plantType: 'tree',
    });
    expect((await changed.json()).data).toEqual({
      id: herb.id,
      plantType: 'tree',
      plantTypeStatus: 'reviewed',
    });
  });

  it('needs records.review, and keeps active and plot visibility', async () => {
    const reader = await actor('treerepro', ['dataset.read']);
    expect((await reader.send('GET', '/api/curation/plant-types')).status).toBe(403);
    const sp = await createSpecies(t.db, { plantTypeStatus: 'proposed' });
    expect((await reader.send('POST', `/api/species/${sp.id}/plant-type/confirm`, {})).status).toBe(
      403,
    );

    // REVIEW holds no dataset.read_inactive: an inactive proposed species is not theirs.
    const manager = await actor('treerepro', REVIEW);
    await t.db.update(species).set({ active: false }).where(eq(species.id, sp.id));
    expect(await queueIds(manager.send)).not.toContain(sp.id);
    expect(
      (await manager.send('POST', `/api/species/${sp.id}/plant-type/confirm`, {})).status,
    ).toBe(404);
    const bad = await manager.send('POST', `/api/species/${sp.id}/plant-type/confirm`, {
      plantType: 'shrub',
    });
    expect(bad.status).toBe(400);
  });
});

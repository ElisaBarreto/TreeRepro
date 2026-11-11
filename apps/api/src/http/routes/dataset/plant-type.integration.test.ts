import { randomBytes } from 'node:crypto';
import type { PermissionKey, Platform } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, TEST_PLANT_ORIGIN, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import { createSpecies } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { speciesProposals } from '../../../db/schema/proposals.ts';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-65 R18, R19 / RFC-75 R2, R4 / RFC-60 R6 plant type', () => {
  const t = useTestApp();

  /** A user holding `permissions` on `platform`, and a caller on that platform's host. */
  async function actor(platform: Platform, permissions: PermissionKey[]) {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id], platform });
    const { cookie } = await loginAs(t, user, { platform });
    const host = platform === 'plantrepro' ? 'http://plantrepro.localhost' : '';
    const origin = platform === 'plantrepro' ? TEST_PLANT_ORIGIN : undefined;
    return {
      user,
      send: (method: string, path: string, body?: unknown) =>
        call(t.app, method, `${host}${path}`, { cookie, body, origin }),
    };
  }

  const MANAGE: PermissionKey[] = ['taxa.manage', 'dataset.read'];
  const REVIEW: PermissionKey[] = [...MANAGE, 'records.review'];

  it('TreeRepro: POST /api/species is a tree whatever is omitted; another type is a 400; the status follows records.review', async () => {
    const plain = await actor('treerepro', MANAGE);
    const reviewer = await actor('treerepro', REVIEW);

    const omitted = await plain.send('POST', '/api/species', {
      canonicalName: `Arbor omissa-${tag()}`,
      nameSource: 'original',
    });
    expect(omitted.status).toBe(201);
    expect((await omitted.json()).data).toMatchObject({
      plantType: 'tree',
      plantTypeStatus: 'proposed',
    });

    const stated = await reviewer.send('POST', '/api/species', {
      canonicalName: `Arbor dicta-${tag()}`,
      nameSource: 'original',
      plantType: 'tree',
    });
    expect((await stated.json()).data).toMatchObject({
      plantType: 'tree',
      plantTypeStatus: 'reviewed',
    });

    const name = `Herba vetita-${tag()}`;
    const refused = await reviewer.send('POST', '/api/species', {
      canonicalName: name,
      nameSource: 'original',
      plantType: 'not_tree',
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'plantType' }],
    });
  });

  it('PlantRepro: POST /api/species requires the type and stores the one stated', async () => {
    const plain = await actor('plantrepro', MANAGE);
    const reviewer = await actor('plantrepro', REVIEW);

    const missing = await plain.send('POST', '/api/species', {
      canonicalName: `Herba sine-${tag()}`,
      nameSource: 'original',
    });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.details).toEqual([
      { path: 'plantType', message: 'Required' },
    ]);

    const proposed = await plain.send('POST', '/api/species', {
      canonicalName: `Herba nova-${tag()}`,
      nameSource: 'original',
      plantType: 'not_tree',
    });
    expect((await proposed.json()).data).toMatchObject({
      plantType: 'not_tree',
      plantTypeStatus: 'proposed',
    });
    const reviewed = await reviewer.send('POST', '/api/species', {
      canonicalName: `Herba recensa-${tag()}`,
      nameSource: 'original',
      plantType: 'not_tree',
    });
    expect((await reviewed.json()).data).toMatchObject({
      plantType: 'not_tree',
      plantTypeStatus: 'reviewed',
    });
  });

  it('a proposal states its type; the approval keeps or changes it, and the approver decides the status', async () => {
    const proposer = await actor('plantrepro', ['taxa.propose', 'dataset.read']);
    const approver = await actor('plantrepro', MANAGE);
    const reviewer = await actor('plantrepro', REVIEW);

    const missing = await proposer.send('POST', '/api/species/proposals', {
      name: `Propositia sine-${tag()}`,
    });
    expect(missing.status).toBe(400);

    const kept = await proposer.send('POST', '/api/species/proposals', {
      name: `Propositia servata-${tag()}`,
      plantType: 'not_tree',
    });
    expect(kept.status).toBe(201);
    const keptProposal = (await kept.json()).data;
    expect(keptProposal.plantType).toBe('not_tree');
    const approved = await approver.send(
      'POST',
      `/api/species/proposals/${keptProposal.id}/approve`,
      { canonicalName: keptProposal.proposedName, nameSource: 'original' },
    );
    expect(approved.status).toBe(200);
    const keptSpecies = (await approved.json()).data.species.id;
    const detail = await approver.send('GET', `/api/species/${keptSpecies}`);
    expect((await detail.json()).data).toMatchObject({
      plantType: 'not_tree',
      plantTypeStatus: 'proposed',
    });

    const changed = await proposer.send('POST', '/api/species/proposals', {
      name: `Propositia mutata-${tag()}`,
      plantType: 'not_tree',
    });
    const changedProposal = (await changed.json()).data;
    const byReviewer = await reviewer.send(
      'POST',
      `/api/species/proposals/${changedProposal.id}/approve`,
      { canonicalName: changedProposal.proposedName, nameSource: 'original', plantType: 'tree' },
    );
    const changedSpecies = (await byReviewer.json()).data.species.id;
    const changedDetail = await reviewer.send('GET', `/api/species/${changedSpecies}`);
    expect((await changedDetail.json()).data).toMatchObject({
      plantType: 'tree',
      plantTypeStatus: 'reviewed',
    });
  });

  it('TreeRepro: a proposal is a tree; a not-tree proposal cannot be approved there; a pre-0058 proposal approves as a tree', async () => {
    const proposer = await actor('treerepro', ['taxa.propose', 'dataset.read']);
    const approver = await actor('treerepro', MANAGE);

    const refused = await proposer.send('POST', '/api/species/proposals', {
      name: `Propositia herba-${tag()}`,
      plantType: 'not_tree',
    });
    expect(refused.status).toBe(400);
    const tree = await proposer.send('POST', '/api/species/proposals', {
      name: `Propositia arbor-${tag()}`,
    });
    expect((await tree.json()).data.plantType).toBe('tree');

    // A not-tree proposal made on PlantRepro.
    const plantProposer = await actor('plantrepro', ['taxa.propose', 'dataset.read']);
    const plant = (
      await (
        await plantProposer.send('POST', '/api/species/proposals', {
          name: `Propositia aliena-${tag()}`,
          plantType: 'not_tree',
        })
      ).json()
    ).data;
    const notHere = await approver.send('POST', `/api/species/proposals/${plant.id}/approve`, {
      canonicalName: plant.proposedName,
      nameSource: 'original',
    });
    expect(notHere.status).toBe(400);
    expect((await notHere.json()).error.details).toMatchObject([{ path: 'plantType' }]);

    // A proposal made before migration 0058 states no type.
    const legacy = (
      await (
        await proposer.send('POST', '/api/species/proposals', { name: `Propositia vetus-${tag()}` })
      ).json()
    ).data;
    await t.db
      .update(speciesProposals)
      .set({ plantType: null })
      .where(eq(speciesProposals.id, legacy.id));
    const plantApprover = await actor('plantrepro', MANAGE);
    const unstated = await plantApprover.send(
      'POST',
      `/api/species/proposals/${legacy.id}/approve`,
      { canonicalName: legacy.proposedName, nameSource: 'original' },
    );
    expect(unstated.status).toBe(400);
    const asTree = await approver.send('POST', `/api/species/proposals/${legacy.id}/approve`, {
      canonicalName: legacy.proposedName,
      nameSource: 'original',
    });
    expect(asTree.status).toBe(200);
    const id = (await asTree.json()).data.species.id;
    expect((await (await approver.send('GET', `/api/species/${id}`)).json()).data).toMatchObject({
      plantType: 'tree',
      plantTypeStatus: 'proposed',
    });
  });

  it('POST /api/species/:id/plant-type needs records.review, sets reviewed and audits the old and new values', async () => {
    const plain = await actor('treerepro', MANAGE);
    const reviewer = await actor('treerepro', REVIEW);
    const sp = await createSpecies(t.db, { plantTypeStatus: 'proposed' });

    const denied = await plain.send('POST', `/api/species/${sp.id}/plant-type`, {
      plantType: 'tree',
    });
    expect(denied.status).toBe(403);

    const confirmed = await reviewer.send('POST', `/api/species/${sp.id}/plant-type`, {
      plantType: 'tree',
    });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).data).toMatchObject({
      id: sp.id,
      plantType: 'tree',
      plantTypeStatus: 'reviewed',
    });
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: sp.id }))?.metadata).toEqual({
      kind: 'species',
      fields: ['plantType'],
      from: { plantType: 'tree', plantTypeStatus: 'proposed' },
      to: { plantType: 'tree', plantTypeStatus: 'reviewed' },
    });

    // A manager on TreeRepro may reclassify a tree.
    const reclassified = await reviewer.send('POST', `/api/species/${sp.id}/plant-type`, {
      plantType: 'not_tree',
    });
    expect((await reclassified.json()).data.plantType).toBe('not_tree');
    const audit = await lastAudit(t.db, 'taxa.updated', { targetId: sp.id });
    expect(audit?.metadata).toMatchObject({
      from: { plantType: 'tree', plantTypeStatus: 'reviewed' },
      to: { plantType: 'not_tree', plantTypeStatus: 'reviewed' },
    });

    // The same type again changes nothing and records nothing.
    const again = await reviewer.send('POST', `/api/species/${sp.id}/plant-type`, {
      plantType: 'not_tree',
    });
    expect(again.status).toBe(200);
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: sp.id }))?.id).toBe(audit?.id);

    const unknown = await reviewer.send(
      'POST',
      '/api/species/00000000-0000-7000-8000-000000000000/plant-type',
      { plantType: 'tree' },
    );
    expect(unknown.status).toBe(404);
    const invalid = await reviewer.send('POST', `/api/species/${sp.id}/plant-type`, {
      plantType: 'shrub',
    });
    expect(invalid.status).toBe(400);
  });

  it('GET /api/species filters and sorts by plant type and carries it on the item', async () => {
    const reader = await actor('treerepro', ['dataset.read']);
    const k = tag();
    const tree = await createSpecies(t.db, { canonicalName: `Typus ${k} a` });
    const herb = await createSpecies(t.db, {
      canonicalName: `Typus ${k} b`,
      plantType: 'not_tree',
      plantTypeStatus: 'proposed',
    });

    const all = await reader.send('GET', `/api/species?q=${encodeURIComponent(`Typus ${k}`)}`);
    expect((await all.json()).data).toEqual([
      expect.objectContaining({ id: tree.id, plantType: 'tree', plantTypeStatus: 'reviewed' }),
      expect.objectContaining({ id: herb.id, plantType: 'not_tree', plantTypeStatus: 'proposed' }),
    ]);
    const onlyHerbs = await reader.send(
      'GET',
      `/api/species?q=${encodeURIComponent(`Typus ${k}`)}&plantType=not_tree`,
    );
    expect((await onlyHerbs.json()).data.map((s: { id: string }) => s.id)).toEqual([herb.id]);
    const count = await reader.send(
      'GET',
      `/api/species/count?q=${encodeURIComponent(`Typus ${k}`)}&plantType=tree`,
    );
    expect((await count.json()).data.count).toBe(1);
    const sorted = await reader.send(
      'GET',
      `/api/species?q=${encodeURIComponent(`Typus ${k}`)}&sort=plantType&order=desc`,
    );
    expect((await sorted.json()).data.map((s: { id: string }) => s.id)).toEqual([tree.id, herb.id]);
    const bad = await reader.send('GET', '/api/species?plantType=shrub');
    expect(bad.status).toBe(400);
  });
});

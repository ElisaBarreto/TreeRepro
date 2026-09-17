import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { lastAudit } from '../../test/helpers/audit.ts';
import { createSpecies, createPlot as helperCreatePlot } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { plotSpecies, userPlots } from '../db/schema/plots.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import {
  addPlotSpeciesMember,
  createPlot,
  getPlot,
  listPlotSpecies,
  listPlots,
  listPlotUsers,
  removePlotSpeciesMember,
  updatePlot,
} from './plots.ts';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-67 R3, R5 plots service', () => {
  const t = useTestDb();

  it('creates a plot, audits plots.created, and prevents case-insensitive code collisions', async () => {
    const { user: actor } = await createUser(t.db);
    const code = `P-${tag()}`;
    const plot = await createPlot(t.db, {
      code,
      name: 'Alpha Plot',
      description: 'Test description',
      latitude: -15.5,
      longitude: -47.8,
      country: 'Brazil',
      biome: 'Cerrado',
      actorId: actor.id,
    });

    expect(plot).toMatchObject({
      code,
      name: 'Alpha Plot',
      description: 'Test description',
      latitude: -15.5,
      longitude: -47.8,
      country: 'Brazil',
      biome: 'Cerrado',
      speciesCount: 0,
      userCount: 0,
    });
    expect(typeof plot.id).toBe('string');
    expect(typeof plot.createdAt).toBe('string');
    expect(typeof plot.updatedAt).toBe('string');

    const audit = await lastAudit(t.db, 'plots.created', { targetId: plot.id });
    expect(audit).toBeDefined();
    expect(audit?.actorUserId).toBe(actor.id);
    expect(audit?.targetType).toBe('plots');

    // Duplicate code case-insensitively throws PLOT_CODE_TAKEN
    await expect(
      createPlot(t.db, {
        code: code.toLowerCase(),
        name: 'Collision Plot',
        actorId: actor.id,
      }),
    ).rejects.toMatchObject({
      code: 'PLOT_CODE_TAKEN',
      status: 409,
    });
  });

  it('getPlot returns userCount only when requested; returns null when not found', async () => {
    const created = await helperCreatePlot(t.db, { code: `GET-${tag()}`, name: 'Get Plot' });
    const { user } = await createUser(t.db);
    await t.db.insert(userPlots).values({ userId: user.id, plotId: created.id });

    const withoutUsers = await getPlot(t.db, created.id, { withUserCount: false });
    expect(withoutUsers?.id).toBe(created.id);
    expect(withoutUsers?.userCount).toBeNull();

    const withUsers = await getPlot(t.db, created.id, { withUserCount: true });
    expect(withUsers?.id).toBe(created.id);
    expect(withUsers?.userCount).toBe(1);

    const unknown = await getPlot(t.db, '00000000-0000-0000-0000-000000000000', {
      withUserCount: true,
    });
    expect(unknown).toBeNull();
  });

  it('listPlots lists plots by code then id, computes speciesCount, filters by q, and paginates', async () => {
    const k = tag();
    const p1 = await helperCreatePlot(t.db, { code: `LIST-${k}-1`, name: `Forest ${k} A` });
    const p2 = await helperCreatePlot(t.db, { code: `LIST-${k}-2`, name: `Savanna ${k} B` });
    const sp = await createSpecies(t.db);
    await t.db.insert(plotSpecies).values({ plotId: p1.id, speciesId: sp.id });

    // By prefix of code
    const byCode = await listPlots(t.db, { q: `list-${k}`, limit: 10 });
    expect(byCode.data.map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(byCode.data[0]?.speciesCount).toBe(1);
    expect(byCode.data[1]?.speciesCount).toBe(0);

    // By substring of name
    const byName = await listPlots(t.db, { q: `Savanna ${k}`, limit: 10 });
    expect(byName.data.map((p) => p.id)).toEqual([p2.id]);

    // Pagination
    const page1 = await listPlots(t.db, { q: `list-${k}`, limit: 1 });
    expect(page1.data).toHaveLength(1);
    expect(page1.data[0]?.id).toBe(p1.id);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await listPlots(t.db, {
      q: `list-${k}`,
      cursor: page1.nextCursor as string,
      limit: 1,
    });
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0]?.id).toBe(p2.id);
  });

  it('updatePlot audits changed fields, throws on collision or unknown, and records nothing if no change', async () => {
    const { user: actor } = await createUser(t.db);
    const code = `UPD-${tag()}`;
    const plot = await createPlot(t.db, {
      code,
      name: 'Initial Name',
      country: 'Brazil',
      actorId: actor.id,
    });

    const updated = await updatePlot(t.db, plot.id, {
      name: 'New Name',
      country: null,
      actorId: actor.id,
    });
    expect(updated.name).toBe('New Name');
    expect(updated.country).toBeNull();

    const audit = await lastAudit(t.db, 'plots.updated', { targetId: plot.id });
    expect(audit).toBeDefined();
    expect(audit?.actorUserId).toBe(actor.id);
    const metadata = audit?.metadata as { fields?: string[] } | undefined;
    expect(metadata?.fields?.slice().sort()).toEqual(['country', 'name']);

    // No change records nothing
    const countBefore = await t.db.select().from(auditLog).where(eq(auditLog.targetId, plot.id));
    const unchanged = await updatePlot(t.db, plot.id, {
      name: 'New Name',
      actorId: actor.id,
    });
    expect(unchanged.name).toBe('New Name');
    const countAfter = await t.db.select().from(auditLog).where(eq(auditLog.targetId, plot.id));
    expect(countAfter.length).toBe(countBefore.length);

    // Collision with another plot
    const other = await helperCreatePlot(t.db, { code: `OTH-${tag()}` });
    await expect(
      updatePlot(t.db, plot.id, {
        code: other.code.toLowerCase(),
        actorId: actor.id,
      }),
    ).rejects.toMatchObject({
      code: 'PLOT_CODE_TAKEN',
      status: 409,
    });

    // Unknown plot
    await expect(
      updatePlot(t.db, '00000000-0000-0000-0000-000000000000', {
        name: 'Something',
        actorId: actor.id,
      }),
    ).rejects.toMatchObject({
      code: 'PLOT_NOT_FOUND',
      status: 404,
    });
  });

  it('addPlotSpeciesMember and removePlotSpeciesMember manage membership and audit', async () => {
    const { user: actor } = await createUser(t.db);
    const plot = await helperCreatePlot(t.db);
    const sp = await createSpecies(t.db);

    await addPlotSpeciesMember(t.db, plot.id, sp.id, actor.id);

    const addedAudit = await lastAudit(t.db, 'plots.species_added', { targetId: plot.id });
    expect(addedAudit).toBeDefined();
    expect(addedAudit?.metadata).toMatchObject({ speciesId: sp.id });

    // Adding again throws PLOT_SPECIES_EXISTS
    await expect(addPlotSpeciesMember(t.db, plot.id, sp.id, actor.id)).rejects.toMatchObject({
      code: 'PLOT_SPECIES_EXISTS',
      status: 409,
    });

    // Unknown plot or species throws 404
    await expect(
      addPlotSpeciesMember(t.db, '00000000-0000-0000-0000-000000000000', sp.id, actor.id),
    ).rejects.toMatchObject({ code: 'PLOT_NOT_FOUND', status: 404 });
    await expect(
      addPlotSpeciesMember(t.db, plot.id, '00000000-0000-0000-0000-000000000000', actor.id),
    ).rejects.toMatchObject({ code: 'SPECIES_NOT_FOUND', status: 404 });

    // Remove species
    await removePlotSpeciesMember(t.db, plot.id, sp.id, actor.id);

    const removedAudit = await lastAudit(t.db, 'plots.species_removed', { targetId: plot.id });
    expect(removedAudit).toBeDefined();
    expect(removedAudit?.metadata).toMatchObject({ speciesId: sp.id });

    // Removing when not a member throws 404
    await expect(removePlotSpeciesMember(t.db, plot.id, sp.id, actor.id)).rejects.toMatchObject({
      code: 'SPECIES_NOT_FOUND',
      status: 404,
    });

    // Unknown plot on removal throws 404 PLOT_NOT_FOUND
    await expect(
      removePlotSpeciesMember(t.db, '00000000-0000-0000-0000-000000000000', sp.id, actor.id),
    ).rejects.toMatchObject({ code: 'PLOT_NOT_FOUND', status: 404 });
  });

  it('listPlotSpecies respects visibility (inactive species hidden from RESTRICTED)', async () => {
    const plot = await helperCreatePlot(t.db);
    const activeSp = await createSpecies(t.db, { canonicalName: `Plotsp active-${tag()}` });
    const inactiveSp = await createSpecies(t.db, { canonicalName: `Plotsp inactive-${tag()}` });
    await t.db.update(species).set({ active: false }).where(eq(species.id, inactiveSp.id));

    await t.db.insert(plotSpecies).values([
      { plotId: plot.id, speciesId: activeSp.id },
      { plotId: plot.id, speciesId: inactiveSp.id },
    ]);

    // Unrestricted sees both
    const unres = await listPlotSpecies(t.db, UNRESTRICTED, plot.id, { limit: 10 });
    expect(unres.data.map((s) => s.id)).toEqual([activeSp.id, inactiveSp.id]);

    // Restricted viewer (only active species) sees only activeSp
    const restricted = await listPlotSpecies(t.db, RESTRICTED, plot.id, { limit: 10 });
    expect(restricted.data.map((s) => s.id)).toEqual([activeSp.id]);

    // Unknown plot throws PLOT_NOT_FOUND
    await expect(
      listPlotSpecies(t.db, UNRESTRICTED, '00000000-0000-0000-0000-000000000000', { limit: 10 }),
    ).rejects.toMatchObject({ code: 'PLOT_NOT_FOUND', status: 404 });
  });

  it('listPlotUsers returns restricted flag and decrypted names sorted by name', async () => {
    const plot = await helperCreatePlot(t.db);
    const { user: u1 } = await createUser(t.db, { name: 'Zara Researcher' });
    const { user: u2 } = await createUser(t.db, { name: 'Aaron Contributor' });
    await t.db.update(users).set({ restrictToAssignedPlots: true }).where(eq(users.id, u2.id));

    await t.db.insert(userPlots).values([
      { plotId: plot.id, userId: u1.id },
      { plotId: plot.id, userId: u2.id },
    ]);

    const res = await listPlotUsers(t.db, plot.id, { limit: 10 });
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({
      id: u2.id,
      name: 'Aaron Contributor',
      restricted: true,
      status: 'active',
    });
    expect(res.data[1]).toMatchObject({
      id: u1.id,
      name: 'Zara Researcher',
      restricted: false,
      status: 'active',
    });

    // Unknown plot throws PLOT_NOT_FOUND
    await expect(
      listPlotUsers(t.db, '00000000-0000-0000-0000-000000000000', { limit: 10 }),
    ).rejects.toMatchObject({ code: 'PLOT_NOT_FOUND', status: 404 });
  });
});

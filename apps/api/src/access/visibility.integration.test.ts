import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../test/helpers/app.ts';
import {
  addPlotSpecies,
  assignPlots,
  createPlot,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { createRole } from '../../test/helpers/roles.ts';
import { loginAs } from '../../test/helpers/session.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { traits } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import { speciesVisible, traitVisible, type Visibility, visibilityFor } from './visibility.ts';

describe('RFC-33 R1 visibilityFor', () => {
  it('reads dataset.read_inactive and plot settings', () => {
    expect(visibilityFor(new Set(['dataset.read']))).toEqual({ inactive: false, plotIds: null });
    expect(visibilityFor(new Set(['dataset.read', 'dataset.read_inactive']))).toEqual({
      inactive: true,
      plotIds: null,
    });
    expect(
      visibilityFor(new Set(['dataset.read']), {
        restricted: true,
        plotIds: ['019a0000-0000-7000-8000-000000000001'],
      }),
    ).toEqual({
      inactive: false,
      plotIds: ['019a0000-0000-7000-8000-000000000001'],
    });
  });
});

describe('RFC-33 R2 predicates', () => {
  const t = useTestApp();

  it('hide an inactive species and trait from a restricted viewer only', async () => {
    const hidden = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(sql`${species.id} = ${hidden.id}`);
    const shown = await createSpecies(t.db);
    const rows = async (v: typeof RESTRICTED) =>
      (
        await t.db
          .select({ id: species.id })
          .from(species)
          .where(sql`${species.id} in (${hidden.id}, ${shown.id}) and ${speciesVisible(v)}`)
      ).map((r) => r.id);
    expect(await rows(RESTRICTED)).toEqual([shown.id]);
    expect((await rows(UNRESTRICTED)).sort()).toEqual([hidden.id, shown.id].sort());

    const off = await createTrait(t.db, { active: false });
    const [restricted] = await t.db
      .select({ id: traits.id })
      .from(traits)
      .where(sql`${traits.id} = ${off.id} and ${traitVisible(RESTRICTED)}`);
    expect(restricted).toBeUndefined();
    const [unrestricted] = await t.db
      .select({ id: traits.id })
      .from(traits)
      .where(sql`${traits.id} = ${off.id} and ${traitVisible(UNRESTRICTED)}`);
    expect(unrestricted?.id).toBe(off.id);
  });

  it('a plot-bound viewer sees a species in the plot and not one outside', async () => {
    const plot = await createPlot(t.db);
    const inside = await createSpecies(t.db);
    const outside = await createSpecies(t.db);
    await addPlotSpecies(t.db, plot.id, [inside.id]);

    const boundVisibility = { inactive: false, plotIds: [plot.id] };
    const rows = async (v: Visibility) =>
      (
        await t.db
          .select({ id: species.id })
          .from(species)
          .where(sql`${species.id} in (${inside.id}, ${outside.id}) and ${speciesVisible(v)}`)
      ).map((r) => r.id);

    expect(await rows(boundVisibility)).toEqual([inside.id]);
    expect(await rows({ inactive: false, plotIds: [] })).toEqual([]);
    expect((await rows(UNRESTRICTED)).sort()).toEqual([inside.id, outside.id].sort());
  });

  it('visibilityOf in a real request enforces plot-bound visibility', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const plot = await createPlot(t.db);
    const inside = await createSpecies(t.db);
    const outside = await createSpecies(t.db);
    await addPlotSpecies(t.db, plot.id, [inside.id]);

    // Assign restricted
    await assignPlots(t.db, user.id, [plot.id], true);
    const { cookie } = await loginAs(t, user);

    const outsideQuery = await call(
      t.app,
      'GET',
      `/api/species?q=${encodeURIComponent(outside.canonicalName)}`,
      { cookie },
    );
    expect(outsideQuery.status).toBe(200);
    expect((await outsideQuery.json()).data).toHaveLength(0);

    const outsideDetail = await call(t.app, 'GET', `/api/species/${outside.id}`, { cookie });
    expect(outsideDetail.status).toBe(404);

    const insideDetail = await call(t.app, 'GET', `/api/species/${inside.id}`, { cookie });
    expect(insideDetail.status).toBe(200);

    // Unassign restriction
    await assignPlots(t.db, user.id, [plot.id], false);
    const unbQuery = await call(
      t.app,
      'GET',
      `/api/species?q=${encodeURIComponent(outside.canonicalName)}&scope=all`,
      { cookie },
    );
    expect(unbQuery.status).toBe(200);
    expect((await unbQuery.json()).data).toHaveLength(1);

    const unbDetail = await call(t.app, 'GET', `/api/species/${outside.id}`, { cookie });
    expect(unbDetail.status).toBe(200);
  });
});

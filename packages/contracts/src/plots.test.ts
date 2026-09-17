import { describe, expect, it } from 'vitest';
import { meResponseSchema } from './auth.ts';
import { listSpeciesQuerySchema, speciesSchema } from './dataset.ts';
import {
  createPlotBodySchema,
  listPlotsQuerySchema,
  plotDetailSchema,
  plotRefSchema,
  plotSchema,
  plotSpeciesBodySchema,
  plotUserSchema,
  SPECIES_SCOPES,
  updatePlotBodySchema,
} from './plots.ts';
import { setUserPlotsBodySchema, userSchema } from './users.ts';

describe('RFC-67 R1, R5 plot contracts', () => {
  const plotId = '019a0000-0000-7000-8000-000000000001';
  const speciesId = '019a0000-0000-7000-8000-000000000002';
  const userId = '019a0000-0000-7000-8000-000000000003';

  it('createPlotBodySchema accepts valid body and rejects latitude 91', () => {
    const valid = createPlotBodySchema.parse({
      code: '  PLOT-1  ',
      name: 'Plot One',
      description: 'Test plot',
      latitude: -15.5,
      longitude: -47.8,
      country: 'Brazil',
      biome: 'Cerrado',
    });
    expect(valid.code).toBe('PLOT-1');
    expect(valid.latitude).toBe(-15.5);

    const badLat = createPlotBodySchema.safeParse({
      code: 'PLOT-2',
      name: 'Plot Two',
      latitude: 91,
    });
    expect(badLat.success).toBe(false);

    const badLon = createPlotBodySchema.safeParse({
      code: 'PLOT-2',
      name: 'Plot Two',
      longitude: 181,
    });
    expect(badLon.success).toBe(false);
  });

  it('updatePlotBodySchema rejects empty object and validates fields', () => {
    const empty = updatePlotBodySchema.safeParse({});
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0]?.path).toEqual(['code']);
    }

    const valid = updatePlotBodySchema.parse({
      name: 'Updated Name',
      latitude: null,
    });
    expect(valid.name).toBe('Updated Name');
    expect(valid.latitude).toBeNull();
  });

  it('plotRefSchema, plotSchema, plotDetailSchema validate correctly', () => {
    const ref = plotRefSchema.parse({ id: plotId, code: 'P1', name: 'Plot 1' });
    expect(ref.code).toBe('P1');

    const plot = plotSchema.parse({
      id: plotId,
      code: 'P1',
      name: 'Plot 1',
      description: 'Desc',
      latitude: null,
      longitude: null,
      country: null,
      biome: null,
      speciesCount: 5,
      createdAt: '2026-09-17T00:00:00Z',
      updatedAt: '2026-09-17T00:00:00Z',
    });
    expect(plot.speciesCount).toBe(5);

    const detail = plotDetailSchema.parse({
      ...plot,
      userCount: 2,
    });
    expect(detail.userCount).toBe(2);

    const detailNullUser = plotDetailSchema.parse({
      ...plot,
      userCount: null,
    });
    expect(detailNullUser.userCount).toBeNull();
  });

  it('listPlotsQuerySchema accepts optional q and cursor', () => {
    const q = listPlotsQuerySchema.parse({ q: 'plot', limit: '10' });
    expect(q.q).toBe('plot');
    expect(q.limit).toBe(10);
  });

  it('plotSpeciesBodySchema accepts valid speciesId', () => {
    const parsed = plotSpeciesBodySchema.parse({ speciesId });
    expect(parsed.speciesId).toBe(speciesId);
  });

  it('plotUserSchema validates user representation', () => {
    const parsed = plotUserSchema.parse({
      id: userId,
      name: 'User 1',
      email: 'user@example.com',
      status: 'active',
      restricted: true,
    });
    expect(parsed.restricted).toBe(true);
  });
});

describe('RFC-67 R6 user plots and setUserPlotsBodySchema', () => {
  const plotId = '019a0000-0000-7000-8000-000000000001';

  it('setUserPlotsBodySchema rejects { plotIds: [], restrictToAssignedPlots: true } with path plotIds', () => {
    const rejected = setUserPlotsBodySchema.safeParse({
      plotIds: [],
      restrictToAssignedPlots: true,
    });
    expect(rejected.success).toBe(false);
    if (!rejected.success) {
      expect(rejected.error.issues[0]?.path).toEqual(['plotIds']);
      expect(rejected.error.issues[0]?.message).toBe('A restricted user needs at least one plot');
    }

    const acceptedUnrestricted = setUserPlotsBodySchema.parse({
      plotIds: [],
      restrictToAssignedPlots: false,
    });
    expect(acceptedUnrestricted.plotIds).toEqual([]);
    expect(acceptedUnrestricted.restrictToAssignedPlots).toBe(false);

    const acceptedRestricted = setUserPlotsBodySchema.parse({
      plotIds: [plotId],
      restrictToAssignedPlots: true,
    });
    expect(acceptedRestricted.plotIds).toEqual([plotId]);
    expect(acceptedRestricted.restrictToAssignedPlots).toBe(true);
  });

  it('userSchema includes plots array and restrictToAssignedPlots flag', () => {
    const u = userSchema.parse({
      id: '019a0000-0000-7000-8000-000000000001',
      email: 'user@example.com',
      name: 'User One',
      status: 'active',
      totpEnabled: false,
      roles: [],
      plots: [{ id: plotId, code: 'P1', name: 'Plot 1' }],
      restrictToAssignedPlots: true,
      createdAt: '2026-09-17T00:00:00Z',
      updatedAt: '2026-09-17T00:00:00Z',
      suspendedAt: null,
    });
    expect(u.plots).toHaveLength(1);
    expect(u.restrictToAssignedPlots).toBe(true);
  });
});

describe('RFC-22 R10 / RFC-33 R8 meResponseSchema', () => {
  it('meResponseSchema requires scope', () => {
    const withoutScope = meResponseSchema.safeParse({
      user: {
        id: '019a0000-0000-7000-8000-000000000001',
        email: 'user@example.com',
        name: 'User One',
        status: 'active',
        totpEnabled: false,
        createdAt: '2026-09-17T00:00:00Z',
      },
      permissions: ['dataset.read'],
    });
    expect(withoutScope.success).toBe(false);

    const withScope = meResponseSchema.parse({
      user: {
        id: '019a0000-0000-7000-8000-000000000001',
        email: 'user@example.com',
        name: 'User One',
        status: 'active',
        totpEnabled: false,
        createdAt: '2026-09-17T00:00:00Z',
      },
      permissions: ['dataset.read'],
      scope: {
        plots: [{ id: '019a0000-0000-7000-8000-000000000001', code: 'P1', name: 'Plot 1' }],
        restricted: true,
      },
    });
    expect(withScope.scope.restricted).toBe(true);
    expect(withScope.scope.plots).toHaveLength(1);
  });
});

describe('RFC-60 R6, R7 / RFC-33 R6 dataset contracts scope', () => {
  it('SPECIES_SCOPES contains plots and all', () => {
    expect(SPECIES_SCOPES).toEqual(['plots', 'all']);
  });

  it('listSpeciesQuerySchema accepts scope and plotId', () => {
    const plotId = '019a0000-0000-7000-8000-000000000001';
    const parsed = listSpeciesQuerySchema.parse({
      scope: 'plots',
      plotId,
    });
    expect(parsed.scope).toBe('plots');
    expect(parsed.plotId).toBe(plotId);
  });

  it('speciesSchema includes plots array', () => {
    const species = speciesSchema.parse({
      id: '019a0000-0000-7000-8000-000000000001',
      canonicalName: 'Quercus robur',
      nameSource: 'wcvp',
      active: true,
      genus: null,
      family: null,
      matchedName: null,
      unresolvedTaxon: false,
      names: [],
      plots: [{ id: '019a0000-0000-7000-8000-000000000002', code: 'P1', name: 'Plot 1' }],
      recordCount: 0,
      traitCount: 0,
    });
    expect(species.plots).toHaveLength(1);
  });
});

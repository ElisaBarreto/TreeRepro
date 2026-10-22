import type { MapEntry, MapValues } from '@treerepro/contracts';

/** A map entry as `GET /api/maps` answers it (RFC-76 R5). @rfc RFC-76 R5 */
export function mapEntry(overrides: Partial<MapEntry> = {}): MapEntry {
  return {
    traitId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01',
    kind: 'completeness',
    levelId: null,
    regions: 2,
    computedAt: '2026-10-23T03:00:00.000Z',
    ...overrides,
  };
}

/** One map's regions and legend (RFC-76 R6): Brazil coloured, Peru with too few species. @rfc RFC-76 R6 */
export const MAP_VALUES: MapValues = {
  regions: [
    { code: 'BZL', name: 'Brazil West-Central', value: 42.5, nSpecies: 120, fill: '#B63875' },
    { code: 'PER', name: 'Peru', value: null, nSpecies: 2, fill: '#EBEBEB' },
  ],
  legend: {
    stops: ['#FCFDBF', '#FE9F6D', '#DE4968', '#8C2981', '#3B0F70', '#000004'],
    limits: [0, 100],
    log: false,
    percent: true,
    label: '% of species with data',
    unit: null,
  },
  computedAt: '2026-10-23T03:00:00.000Z',
};

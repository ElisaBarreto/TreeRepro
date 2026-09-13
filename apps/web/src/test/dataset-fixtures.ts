import type { Dictionary, ImportBatch, ImportReject, Reference } from '@treerepro/contracts';

/**
 * Two categories in dictionary order: a categorical trait with an inactive
 * level, a quantitative trait without levels and an inactive trait.
 * @rfc RFC-62 R5
 */
export const DICTIONARY: Dictionary = [
  {
    key: 'reproductive_system',
    label: 'Reproductive system',
    traits: [
      {
        id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e01',
        key: 'sexual_system',
        valueType: 'categorical',
        unit: null,
        description: 'Distribution of male and female function among individuals.',
        active: true,
        levels: [
          { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11', key: 'hermaphrodite', active: true },
          { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12', key: 'dioecious', active: true },
          { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e13', key: 'polygamous', active: false },
        ],
      },
    ],
  },
  {
    key: 'seed',
    label: 'Seed',
    traits: [
      {
        id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02',
        key: 'seed_mass',
        valueType: 'quantitative',
        unit: 'mg',
        description: 'Dry mass of one seed.',
        active: true,
        levels: [],
      },
      {
        id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e03',
        key: 'seed_colour',
        valueType: 'categorical',
        unit: null,
        description: 'Colour of the mature seed coat.',
        active: false,
        levels: [{ id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e14', key: 'brown', active: true }],
      },
    ],
  },
];

/** @rfc RFC-61 R4 */
export const REFERENCE: Reference = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8f01',
  citationKey: 'Smith2001',
  title: 'Breeding systems of tropical trees',
  authors: 'Smith, J.; Doe, A.',
  year: 2001,
  journal: 'Journal of Tropical Ecology',
  doi: '10.1000/jte.2001.1',
  url: 'https://example.org/smith2001',
  createdAt: '2026-09-13T09:00:00.000Z',
};

/** A completed batch with one unknown level. @rfc RFC-64 R11 */
export const IMPORT_BATCH: ImportBatch = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c9001',
  fileName: 'records-2026-09.csv',
  fileSha256: 'a3f1c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  status: 'completed',
  runBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e', name: 'Ada' },
  startedAt: '2026-09-13T10:15:30.000Z',
  finishedAt: '2026-09-13T10:42:05.000Z',
  rowsTotal: 12345,
  rowsInserted: 12000,
  rowsDuplicate: 300,
  rowsRejected: 45,
  rowsPending: 210,
  unknownLevels: [{ trait: 'pollination_syndrome', value: 'bees', count: 17 }],
  error: null,
};

/** @rfc RFC-64 R11 */
export const IMPORT_REJECT: ImportReject = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c9101',
  rowNo: 42,
  reason: 'unknown_trait',
  rawRow: {
    primary_reference: 'Smith2001',
    secondary_reference: '',
    wcvp_species: 'Adenanthera pavonina',
    wcvp_genus: 'Adenanthera',
    wcvp_family: 'Fabaceae',
    gbif_species: '',
    gbif_usage_key: '',
    original_species_name: 'Adenanthera pavonina L.',
    secondary_source_species_name: '',
    original_trait_name: 'flower colour',
    final_standard_trait: 'flower_hue',
    broad_category: 'Flower',
    original_value_clean: 'yellow',
    trait_value_type: 'categorical',
    harmonised_value: '',
  },
};

import type {
  Dictionary,
  ImportBatch,
  ImportReject,
  RecordDetail,
  RecordItem,
  Reference,
  ReferenceDetail,
  Species,
  SpeciesTraits,
  TraitRef,
  TraitSummary,
} from '@treerepro/contracts';

/** @rfc RFC-60 R7 */
export const FAMILY = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01', name: 'Fabaceae' };
/** @rfc RFC-60 R7 */
export const GENUS = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d02', name: 'Adenanthera' };

/** A resolved species with one alternative name. @rfc RFC-60 R7 */
export const SPECIES: Species = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d03',
  canonicalName: 'Adenanthera pavonina',
  nameSource: 'wcvp',
  genus: GENUS,
  family: FAMILY,
  matchedName: null,
  names: [{ name: 'Adenanthera gersenii', source: 'gbif', gbifUsageKey: '2969393' }],
  recordCount: 12,
  traitCount: 3,
  unresolvedTaxon: false,
};

/** An unresolved taxon without genus or family. @rfc RFC-60 R3, R7 */
export const UNRESOLVED_SPECIES: Species = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d04',
  canonicalName: 'Adansonia digitata',
  nameSource: 'gbif',
  genus: null,
  family: null,
  matchedName: null,
  names: [],
  recordCount: 0,
  traitCount: 0,
  unresolvedTaxon: true,
};

/** @rfc RFC-62 R5 */
export const SEXUAL_SYSTEM: TraitRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d10',
  key: 'sexual_system',
  valueType: 'categorical',
  unit: null,
};
/** @rfc RFC-62 R5 */
export const SEED_MASS: TraitRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d11',
  key: 'seed_mass',
  valueType: 'quantitative',
  unit: 'mg',
};
/** @rfc RFC-62 R5 */
export const POLLINATION_MODE: TraitRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d12',
  key: 'pollination_mode',
  valueType: 'categorical',
  unit: null,
};

const NO_PENDING = { harmonised: 0, unknownLevel: 0, multiValue: 0, notNumeric: 0, empty: 0 };

/** Categorical summary with three levels and two records pending harmonisation. @rfc RFC-63 R10 */
export const SEXUAL_SYSTEM_SUMMARY: TraitSummary = {
  trait: SEXUAL_SYSTEM,
  recordCount: 8,
  harmonisationCounts: { ...NO_PENDING, harmonised: 6, unknownLevel: 1, multiValue: 1 },
  levels: [
    { levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20', key: 'dioecious', count: 4 },
    { levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d21', key: 'monoecious', count: 1 },
    { levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d22', key: 'hermaphrodite', count: 1 },
  ],
  numeric: null,
  accepted: {
    recordId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d30',
    valueText: 'dioecious',
    decidedAt: '2026-09-10T09:00:00.000Z',
  },
};

/** Quantitative summary, every record harmonised. @rfc RFC-63 R10 */
export const SEED_MASS_SUMMARY: TraitSummary = {
  trait: SEED_MASS,
  recordCount: 3,
  harmonisationCounts: { ...NO_PENDING, harmonised: 3 },
  levels: null,
  numeric: { min: 0.5, median: 1.25, max: 3, count: 3 },
  accepted: null,
};

/** Categorical summary with a single level and nothing pending. @rfc RFC-63 R10 */
export const POLLINATION_MODE_SUMMARY: TraitSummary = {
  trait: POLLINATION_MODE,
  recordCount: 1,
  harmonisationCounts: { ...NO_PENDING, harmonised: 1 },
  levels: [{ levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d23', key: 'insects', count: 1 }],
  numeric: null,
  accepted: null,
};

/** Two categories in dictionary order. @rfc RFC-63 R10 */
export const SPECIES_TRAITS: SpeciesTraits = [
  { category: { key: 'sexual_system', label: 'Sexual system' }, traits: [SEXUAL_SYSTEM_SUMMARY] },
  {
    category: { key: 'pollination', label: 'Pollination' },
    traits: [POLLINATION_MODE_SUMMARY, SEED_MASS_SUMMARY],
  },
];

/** @rfc RFC-61 R4 */
export const PRIMARY_REFERENCE = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d40',
  citationKey: 'Renner2014',
};
/** @rfc RFC-61 R4 */
export const SECONDARY_REFERENCE = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d41',
  citationKey: 'TRY-6.0',
};

/** An imported, harmonised and confirmed categorical record. @rfc RFC-63 R8 */
export const RECORD: RecordItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d50',
  speciesId: SPECIES.id,
  trait: SEXUAL_SYSTEM,
  valueText: 'dioecious',
  level: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20', key: 'dioecious' },
  numericValue: null,
  harmonisation: 'harmonised',
  review: 'confirmed',
  primaryReference: PRIMARY_REFERENCE,
  secondaryReference: SECONDARY_REFERENCE,
  origin: 'import',
  createdAt: '2026-09-01T10:30:00.000Z',
  createdBy: null,
};

/** A manual quantitative record still pending harmonisation and disputed. @rfc RFC-63 R8 */
export const PENDING_RECORD: RecordItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d51',
  speciesId: SPECIES.id,
  trait: SEED_MASS,
  valueText: 'about two',
  level: null,
  numericValue: null,
  harmonisation: 'not_numeric',
  review: 'disputed',
  primaryReference: PRIMARY_REFERENCE,
  secondaryReference: null,
  origin: 'manual',
  createdAt: '2026-09-02T08:00:00.000Z',
  createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e', name: 'Ada' },
};

/** The detail of RECORD: raw columns from the import, no curation yet. @rfc RFC-63 R8 */
export const RECORD_DETAIL: RecordDetail = {
  ...RECORD,
  rawValue: 'Dioecious',
  originalTraitName: 'Sexual System',
  originalSpeciesName: 'Adenanthera pavonina L.',
  secondarySourceSpeciesName: null,
  rawCategory: 'Reproductive biology',
  note: null,
  importBatch: {
    id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d60',
    fileName: 'treerepro-2026-08.csv',
    startedAt: '2026-09-01T10:00:00.000Z',
  },
  importRowNo: 4821,
  annotations: [],
  acceptedHistory: [],
};

/** The detail of PENDING_RECORD: manual, annotated and accepted once. @rfc RFC-63 R8 */
export const CURATED_RECORD_DETAIL: RecordDetail = {
  ...PENDING_RECORD,
  rawValue: null,
  originalTraitName: null,
  originalSpeciesName: null,
  secondarySourceSpeciesName: null,
  rawCategory: null,
  note: 'Field observation, dry season.',
  importBatch: null,
  importRowNo: null,
  annotations: [
    {
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d70',
      kind: 'dispute',
      note: 'Value is not a number.',
      actor: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
      createdAt: '2026-09-03T12:00:00.000Z',
    },
  ],
  acceptedHistory: [
    {
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d80',
      decision: 'accepted',
      recordId: PENDING_RECORD.id,
      actor: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e', name: 'Ada' },
      note: null,
      createdAt: '2026-09-04T12:00:00.000Z',
    },
  ],
};

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

/** REFERENCE with the count `GET /api/references/:id` adds. @rfc RFC-61 R4 */
export const REFERENCE_DETAIL: ReferenceDetail = { ...REFERENCE, recordCount: 2 };

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

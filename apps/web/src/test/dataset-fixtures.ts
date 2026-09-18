import type {
  AcceptedState,
  ContributionAnnotation,
  ContributionRecord,
  ContributionSummary,
  Dictionary,
  DisputedRecord,
  Genus,
  ImportBatch,
  ImportReject,
  MapResult,
  PendingGroup,
  PendingTrait,
  RecordDetail,
  RecordItem,
  Reference,
  ReferenceDetail,
  ReferenceRef,
  Species,
  SpeciesTraits,
  TaxonRef,
  Trait,
  TraitDetail,
  TraitRef,
  TraitSpeciesItem,
  TraitSummary,
} from '@treerepro/contracts';
import { USER } from './fixtures.ts';

/** @rfc RFC-60 R7 */
export const FAMILY = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d01', name: 'Fabaceae' };
/** @rfc RFC-60 R7 */
export const GENUS = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d02', name: 'Adenanthera' };

/** A resolved species with one alternative name. @rfc RFC-60 R7 */
export const SPECIES: Species = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d03',
  canonicalName: 'Adenanthera pavonina',
  nameSource: 'wcvp',
  active: true,
  genus: GENUS,
  family: FAMILY,
  matchedName: null,
  matchedNameType: null,
  names: [
    {
      name: 'Adenanthera gersenii',
      nameType: 'gbif',
      language: null,
      source: 'gbif',
      gbifUsageKey: '2969393',
    },
  ],
  plots: [],
  recordCount: 12,
  traitCount: 3,
  unresolvedTaxon: false,
};

/** An unresolved taxon without genus or family. @rfc RFC-60 R3, R7 */
export const UNRESOLVED_SPECIES: Species = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d04',
  canonicalName: 'Adansonia digitata',
  nameSource: 'gbif',
  active: true,
  genus: null,
  family: null,
  matchedName: null,
  matchedNameType: null,
  names: [],
  plots: [],
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
  kind: 'publication' as const,
};
/** @rfc RFC-61 R4 */
export const SECONDARY_REFERENCE = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d41',
  citationKey: 'TRY-6.0',
  kind: 'publication' as const,
};

/** The reference a scientist's own field work is recorded under. @rfc RFC-61 R7 */
export const PERSONAL_OBSERVATION_REFERENCE: ReferenceRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d42',
  citationKey: `personal-observation:${USER.id}`,
  kind: 'personal_observation',
};

const GRACE_ID = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f';

/**
 * Grace's own field work — a personal observation always resolves to the
 * actor's own row, so a record Grace creates can only cite this one, never
 * {@link PERSONAL_OBSERVATION_REFERENCE} (USER's).
 * @rfc RFC-61 R7
 */
export const GRACE_PERSONAL_OBSERVATION_REFERENCE: ReferenceRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d43',
  citationKey: `personal-observation:${GRACE_ID}`,
  kind: 'personal_observation',
};

/** An imported, harmonised and confirmed categorical record. @rfc RFC-63 R8 */
export const RECORD: RecordItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d50',
  speciesId: SPECIES.id,
  species: { id: SPECIES.id, canonicalName: SPECIES.canonicalName },
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
  intent: null,
  respondsTo: null,
};

/** A manual quantitative record still pending harmonisation and disputed. @rfc RFC-63 R8 */
export const PENDING_RECORD: RecordItem = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d51',
  speciesId: SPECIES.id,
  species: { id: SPECIES.id, canonicalName: SPECIES.canonicalName },
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
  intent: null,
  respondsTo: null,
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
  supersedes: null,
  supersededBy: [],
  responses: [],
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
      reference: null,
      generated: false,
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
  supersedes: null,
  supersededBy: [],
  responses: [],
};

/**
 * A record contesting RECORD, sourced from the author's own observation —
 * Grace's, since Grace is who created it (RFC-61 R7: a personal observation
 * always resolves to the actor's own row).
 * @rfc RFC-70 R6
 */
export const CONTEST_RECORD_DETAIL: RecordDetail = {
  ...RECORD_DETAIL,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d52',
  valueText: 'monoecious',
  level: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d21', key: 'monoecious' },
  review: 'unreviewed',
  origin: 'manual',
  primaryReference: GRACE_PERSONAL_OBSERVATION_REFERENCE,
  secondaryReference: null,
  createdBy: { id: GRACE_ID, name: 'Grace' },
  intent: 'contest',
  respondsTo: { id: RECORD.id },
  importBatch: null,
  importRowNo: null,
};

/**
 * RECORD once it has been answered: the dispute the contest generated and a
 * confirmation backed by a reference, and the two records that answer it —
 * the second by an author this viewer may not see.
 * @rfc RFC-70 R4, R6
 */
export const RESPONDED_RECORD_DETAIL: RecordDetail = {
  ...RECORD_DETAIL,
  annotations: [
    {
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d71',
      kind: 'dispute',
      note: `Contested by record ${CONTEST_RECORD_DETAIL.id}`,
      actor: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
      createdAt: '2026-09-06T12:00:00.000Z',
      reference: null,
      generated: true,
    },
    {
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d72',
      kind: 'confirm',
      note: null,
      actor: { id: USER.id, name: USER.name },
      createdAt: '2026-09-05T12:00:00.000Z',
      reference: PRIMARY_REFERENCE,
      generated: false,
    },
  ],
  responses: [
    {
      id: CONTEST_RECORD_DETAIL.id,
      intent: 'contest',
      createdBy: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
      createdAt: '2026-09-06T12:00:00.000Z',
    },
    {
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d53',
      intent: 'complement',
      createdBy: null,
      createdAt: '2026-09-05T08:00:00.000Z',
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
        speciesCount: 12,
        levels: [
          {
            id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11',
            key: 'hermaphrodite',
            sortOrder: 0,
            active: true,
          },
          {
            id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12',
            key: 'dioecious',
            sortOrder: 1,
            active: true,
          },
          {
            id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e13',
            key: 'polygamous',
            sortOrder: 2,
            active: false,
          },
        ],
      },
      {
        id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e05',
        key: 'self_compatibility',
        valueType: 'categorical',
        unit: null,
        description: 'Whether an individual sets seed with its own pollen.',
        active: true,
        speciesCount: 0,
        levels: [
          {
            id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e15',
            key: 'self_compatible',
            sortOrder: 0,
            active: true,
          },
          {
            id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e16',
            key: 'self_incompatible',
            sortOrder: 1,
            active: true,
          },
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
        speciesCount: 3,
        levels: [],
      },
      {
        id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e03',
        key: 'seed_colour',
        valueType: 'categorical',
        unit: null,
        description: 'Colour of the mature seed coat.',
        active: false,
        speciesCount: 1,
        levels: [
          { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e14', key: 'brown', sortOrder: 0, active: true },
        ],
      },
      {
        id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e06',
        key: 'seed_length',
        valueType: 'quantitative',
        unit: 'mm',
        description: 'Length of the mature seed.',
        active: true,
        speciesCount: 0,
        levels: [],
      },
    ],
  },
];

/** @rfc RFC-60 R8 */
export const MALVACEAE = { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d05', name: 'Malvaceae' };
/** @rfc RFC-60 R8 */
export const FAMILIES: TaxonRef[] = [FAMILY, MALVACEAE];
/** A genus without a family, the case `/app/taxa` moves. @rfc RFC-60 R8 */
export const ADANSONIA_GENUS: Genus = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d06',
  name: 'Adansonia',
  family: null,
};
/** @rfc RFC-60 R8 */
export const GENERA: Genus[] = [{ ...GENUS, family: FAMILY }, ADANSONIA_GENUS];
/** @rfc RFC-62 R5 */
export const SEXUAL_SYSTEM_TRAIT: Trait = DICTIONARY[0]?.traits[0] as Trait;
/** @rfc RFC-62 R5 */
export const SEED_MASS_TRAIT: Trait = DICTIONARY[1]?.traits[0] as Trait;
/** The quantitative trait no summary gives a record. @rfc RFC-62 R5 */
export const SEED_LENGTH_TRAIT: Trait = DICTIONARY[1]?.traits[2] as Trait;
/** What `POST /api/traits` answers for a fresh categorical trait. @rfc RFC-62 R6 */
export const NEW_TRAIT: Trait = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e04',
  key: 'flower_colour',
  valueType: 'categorical',
  unit: null,
  description: '',
  active: true,
  speciesCount: 0,
  levels: [],
};

/**
 * The dictionary's categorical trait as `GET /api/traits/:id` answers it:
 * two levels with harmonised records behind them.
 * @rfc RFC-62 R7
 */
export const SEXUAL_SYSTEM_DETAIL: TraitDetail = {
  ...SEXUAL_SYSTEM_TRAIT,
  speciesCount: 12,
  category: { key: 'reproductive_system', label: 'Reproductive system' },
  speciesWithData: 12,
  speciesMissing: 4,
  acceptedCount: 7,
  distribution: {
    levels: [
      {
        level: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11', key: 'hermaphrodite' },
        speciesCount: 8,
        recordCount: 19,
      },
      {
        level: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12', key: 'dioecious' },
        speciesCount: 4,
        recordCount: 5,
      },
    ],
  },
  computedAt: '2026-09-18T08:00:00.000Z',
};

/** The dictionary's quantitative trait, with a numeric spread. @rfc RFC-62 R7 */
export const SEED_MASS_DETAIL: TraitDetail = {
  ...SEED_MASS_TRAIT,
  speciesCount: 3,
  category: { key: 'seed', label: 'Seed' },
  speciesWithData: 3,
  speciesMissing: 9,
  acceptedCount: 1,
  distribution: { numeric: { min: 0.5, median: 1.25, max: 3, speciesCount: 3 } },
  computedAt: '2026-09-18T08:00:00.000Z',
};

/**
 * A quantitative trait no record has been harmonised for yet: `numeric` is
 * null, which is the shape the distribution section must survive.
 * @rfc RFC-62 R7
 */
export const SEED_LENGTH_DETAIL: TraitDetail = {
  ...SEED_LENGTH_TRAIT,
  speciesCount: 0,
  category: { key: 'seed', label: 'Seed' },
  speciesWithData: 0,
  speciesMissing: 12,
  acceptedCount: 0,
  distribution: { numeric: null },
  computedAt: '2026-09-18T08:00:00.000Z',
};

/** A species row of `mode=with`: records, an accepted value and its summary. @rfc RFC-62 R8 */
export const TRAIT_SPECIES_WITH_DATA: TraitSpeciesItem = {
  id: SPECIES.id,
  canonicalName: SPECIES.canonicalName,
  nameSource: 'wcvp',
  active: true,
  genus: GENUS,
  family: FAMILY,
  matchedName: null,
  matchedNameType: null,
  unresolvedTaxon: false,
  traitCount: 3,
  traitRecordCount: 4,
  recordCount: 4,
  accepted: {
    recordId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d30',
    valueText: 'dioecious',
    reference: { ...PRIMARY_REFERENCE, shortCitation: null },
  },
  summary: {
    levels: [
      { key: 'dioecious', count: 3 },
      { key: 'hermaphrodite', count: 1 },
    ],
  },
};

/** A `mode=with` row whose records no curator has accepted a value from. @rfc RFC-62 R8 */
export const TRAIT_SPECIES_UNDECIDED: TraitSpeciesItem = {
  ...TRAIT_SPECIES_WITH_DATA,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d07',
  canonicalName: 'Adansonia digitata',
  genus: { id: ADANSONIA_GENUS.id, name: ADANSONIA_GENUS.name },
  family: MALVACEAE,
  recordCount: 1,
  accepted: null,
  summary: { numeric: { min: 0.5, max: 3 } },
};

/**
 * A `mode=missing` row: no records, so no count, value or summary.
 * `traitRecordCount` stays 0 — `searchSpecies` always supplies `traitId` here,
 * so its coverage counter is never null, and the coverage row itself does not
 * exist in missing mode by construction (RFC-60 R6, RFC-62 R8).
 * @rfc RFC-62 R8
 */
export const TRAIT_SPECIES_MISSING: TraitSpeciesItem = {
  ...TRAIT_SPECIES_WITH_DATA,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d08',
  canonicalName: 'Ceiba pentandra',
  genus: null,
  family: MALVACEAE,
  traitCount: 0,
  traitRecordCount: 0,
  recordCount: null,
  accepted: null,
  summary: null,
};

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
  primaryCount: 1,
  secondaryCount: 1,
  kind: 'publication',
  observer: null,
};

/** The personal-observation reference of USER, as the references screens see it. @rfc RFC-61 R7 */
export const PERSONAL_OBSERVATION: Reference = {
  id: PERSONAL_OBSERVATION_REFERENCE.id,
  citationKey: PERSONAL_OBSERVATION_REFERENCE.citationKey,
  title: null,
  authors: null,
  year: null,
  journal: null,
  doi: null,
  url: null,
  createdAt: '2026-09-14T09:00:00.000Z',
  primaryCount: 1,
  secondaryCount: 0,
  kind: 'personal_observation',
  observer: { id: USER.id, name: USER.name },
};

/** @rfc RFC-61 R7 */
export const PERSONAL_OBSERVATION_DETAIL: ReferenceDetail = {
  ...PERSONAL_OBSERVATION,
  recordCount: 1,
};

/** REFERENCE with the count `GET /api/references/:id` adds: two records, one per role. @rfc RFC-61 R4 */
export const REFERENCE_DETAIL: ReferenceDetail = { ...REFERENCE, recordCount: 2 };

/** A completed batch with one unknown level. @rfc RFC-64 R11 */
export const IMPORT_BATCH: ImportBatch = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c9001',
  fileName: 'records-2026-09.csv',
  fileSha256: 'a3f1c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  kind: 'records',
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

/** The dictionary's sexual_system trait as a `TraitRef` (its id differs from `SEXUAL_SYSTEM`, which the summaries use). @rfc RFC-62 R5 */
export const DICTIONARY_SEXUAL_SYSTEM: TraitRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e01',
  key: 'sexual_system',
  valueType: 'categorical',
  unit: null,
};

/** The dictionary's seed_mass trait as a `TraitRef` (its id differs from `SEED_MASS`, which the summaries use). @rfc RFC-62 R5 */
export const DICTIONARY_SEED_MASS: TraitRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e02',
  key: 'seed_mass',
  valueType: 'quantitative',
  unit: 'mg',
};

/** The dictionary's self_compatibility trait as a `TraitRef`; no summary gives it a record. @rfc RFC-62 R5 */
export const DICTIONARY_SELF_COMPATIBILITY: TraitRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e05',
  key: 'self_compatibility',
  valueType: 'categorical',
  unit: null,
};

/** The dictionary's seed_length trait as a `TraitRef`; no summary gives it a record. @rfc RFC-62 R5 */
export const DICTIONARY_SEED_LENGTH: TraitRef = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e06',
  key: 'seed_length',
  valueType: 'quantitative',
  unit: 'mm',
};

/**
 * A categorical trait `includeMissing` adds: no record at all, so
 * `levels: []` — never `null`, which stays reserved for a quantitative
 * trait, whatever its record count. Its trait is one no other summary
 * names: the API lists a species' traits once each, so two cards on a page
 * never share a key.
 * @rfc RFC-70 R7
 */
export const SELF_COMPATIBILITY_MISSING_SUMMARY: TraitSummary = {
  trait: DICTIONARY_SELF_COMPATIBILITY,
  recordCount: 0,
  harmonisationCounts: NO_PENDING,
  levels: [],
  numeric: null,
  accepted: null,
};

/** A quantitative trait `includeMissing` adds: `levels: null`, no `numeric`. @rfc RFC-70 R7 */
export const SEED_LENGTH_MISSING_SUMMARY: TraitSummary = {
  trait: DICTIONARY_SEED_LENGTH,
  recordCount: 0,
  harmonisationCounts: NO_PENDING,
  levels: null,
  numeric: null,
  accepted: null,
};

/**
 * `SPECIES_TRAITS` with `includeMissing=true`'s zero-count traits added.
 * The missing traits come from walking `DICTIONARY`, so their categories are
 * `DICTIONARY`'s own (`reproductive_system` / `seed`), not the arbitrary
 * ones `SPECIES_TRAITS` uses for the traits that already have records.
 * @rfc RFC-70 R7
 */
export const SPECIES_TRAITS_WITH_MISSING: SpeciesTraits = [
  {
    category: { key: 'reproductive_system', label: 'Reproductive system' },
    traits: [SEXUAL_SYSTEM_SUMMARY, SELF_COMPATIBILITY_MISSING_SUMMARY],
  },
  {
    category: { key: 'seed', label: 'Seed' },
    traits: [POLLINATION_MODE_SUMMARY, SEED_MASS_SUMMARY, SEED_LENGTH_MISSING_SUMMARY],
  },
];

/** RECORD is the accepted value; one earlier decision was cleared. @rfc RFC-65 R11 */
export const ACCEPTED_STATE: AcceptedState = {
  current: {
    id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d90',
    recordId: RECORD.id,
    valueText: 'dioecious',
    actor: { id: USER.id, name: USER.name },
    note: 'Best sampled population.',
    decidedAt: '2026-09-05T12:00:00.000Z',
  },
  history: [
    {
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d90',
      decision: 'accepted',
      recordId: RECORD.id,
      valueText: 'dioecious',
      actor: { id: USER.id, name: USER.name },
      note: 'Best sampled population.',
      createdAt: '2026-09-05T12:00:00.000Z',
    },
    {
      id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d91',
      decision: 'cleared',
      recordId: null,
      valueText: null,
      actor: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
      note: 'Sources disagree.',
      createdAt: '2026-09-04T12:00:00.000Z',
    },
  ],
};

/** @rfc RFC-65 R11 */
export const EMPTY_ACCEPTED: AcceptedState = { current: null, history: [] };

/** @rfc RFC-65 R8 */
export const PENDING_TRAITS: PendingTrait[] = [
  { trait: DICTIONARY_SEXUAL_SYSTEM, count: 3 },
  { trait: SEED_MASS, count: 1 },
];

/** @rfc RFC-65 R8 */
export const PENDING_GROUPS: PendingGroup[] = [
  {
    valueText: 'dioecious ',
    harmonisation: 'unknown_level',
    count: 2,
    sampleRecordId: PENDING_RECORD.id,
  },
  {
    valueText: 'dioecious;monoecious',
    harmonisation: 'multi_value',
    count: 1,
    sampleRecordId: RECORD.id,
  },
];

/** @rfc RFC-65 R9 */
export const MAP_RESULT: MapResult = { created: 2, skipped: 0 };

/** @rfc RFC-65 R10 */
export const DISPUTED_RECORD: DisputedRecord = {
  ...PENDING_RECORD,
  latestDispute: {
    id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d70',
    actor: { id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9f', name: 'Grace' },
    note: 'Value is not a number.',
    createdAt: '2026-09-03T12:00:00.000Z',
  },
};

/**
 * The viewer's own manual record, as `/api/me/contributions?kind=records`
 * answers it: the current accepted value of its species and trait, with one
 * record answering it.
 * @rfc RFC-71 R2
 */
export const CONTRIBUTION_RECORD: ContributionRecord = {
  ...PENDING_RECORD,
  isAccepted: true,
  responseCount: 1,
};

/** The viewer's own record contesting {@link RECORD}; nobody has accepted it. @rfc RFC-71 R2 */
export const CONTESTING_CONTRIBUTION: ContributionRecord = {
  ...PENDING_RECORD,
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d54',
  trait: SEXUAL_SYSTEM,
  valueText: 'monoecious',
  review: 'unreviewed',
  intent: 'contest',
  respondsTo: { id: RECORD.id },
  createdAt: '2026-09-07T08:00:00.000Z',
  isAccepted: false,
  responseCount: 0,
};

/** A confirmation the viewer wrote, backed by a reference. @rfc RFC-71 R3 */
export const CONTRIBUTION_ANNOTATION: ContributionAnnotation = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d75',
  kind: 'confirm',
  note: 'Matches the herbarium sheet.',
  reference: PRIMARY_REFERENCE,
  generated: false,
  createdAt: '2026-09-08T09:00:00.000Z',
  record: RECORD,
};

/**
 * The dispute a contest generated in the viewer's name: `generated`, which
 * the page reads as "automatic". Its own date is later than the record it
 * annotates, which is what the two date columns keep apart.
 * @rfc RFC-71 R3
 */
export const GENERATED_CONTRIBUTION_ANNOTATION: ContributionAnnotation = {
  id: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d76',
  kind: 'dispute',
  note: `Contested by record ${CONTESTING_CONTRIBUTION.id}`,
  reference: null,
  generated: true,
  createdAt: '2026-09-09T11:00:00.000Z',
  record: PENDING_RECORD,
};

/**
 * A standing with more records than any page lists: the summary counts every
 * row, the lists omit what the viewer may no longer see (RFC-71 R4).
 * @rfc RFC-71 R4
 */
export const CONTRIBUTION_SUMMARY: ContributionSummary = {
  records: 12,
  contests: 2,
  complements: 3,
  validations: 7,
  disputes: 1,
  withdrawn: 1,
  accepted: 4,
};

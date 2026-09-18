import type { Coverage, CoverageTraitRow } from '@treerepro/contracts';
import { DICTIONARY_SEED_MASS, DICTIONARY_SEXUAL_SYSTEM } from './dataset-fixtures.ts';

/** A `byTrait` row with data (RFC-69 R5): sexual_system, mostly complete. @rfc RFC-69 R5 */
export const COVERAGE_TRAIT_SEXUAL_SYSTEM: CoverageTraitRow = {
  trait: DICTIONARY_SEXUAL_SYSTEM,
  category: { key: 'reproductive_system', label: 'Reproductive system' },
  cells: 10,
  withData: 8,
  species: 8,
  accepted: 6,
  percentWithData: 80,
  percentAccepted: 60,
};

/**
 * A `byTrait` row with no record anywhere in the selection (RFC-69 R2: a
 * withdrawn record still counts as data, so a zero here really means no
 * record at all, not merely an unaccepted one).
 * @rfc RFC-69 R5
 */
export const COVERAGE_TRAIT_SEED_MASS: CoverageTraitRow = {
  trait: DICTIONARY_SEED_MASS,
  category: { key: 'reproductive_system', label: 'Reproductive system' },
  cells: 10,
  withData: 0,
  species: 0,
  accepted: 0,
  percentWithData: 0,
  percentAccepted: 0,
};

/** `GET /api/coverage` with no filters (RFC-69 R5). @rfc RFC-69 R5 */
export const COVERAGE: Coverage = {
  species: 10,
  traits: 2,
  cells: 20,
  withData: 8,
  accepted: 6,
  percentWithData: 40,
  percentAccepted: 30,
  byCategory: [
    {
      category: { key: 'reproductive_system', label: 'Reproductive system' },
      traits: 2,
      cells: 20,
      withData: 8,
      accepted: 6,
      percentWithData: 40,
      percentAccepted: 30,
    },
  ],
  byTrait: [COVERAGE_TRAIT_SEXUAL_SYSTEM, COVERAGE_TRAIT_SEED_MASS],
  computedAt: '2026-09-18T00:00:00.000Z',
};

/** `GET /api/coverage/top?mode=missing` (RFC-69 R7): most species lacking a record first. @rfc RFC-69 R7 */
export const COVERAGE_TOP_MISSING: CoverageTraitRow[] = [
  COVERAGE_TRAIT_SEED_MASS,
  COVERAGE_TRAIT_SEXUAL_SYSTEM,
];

/** `GET /api/coverage/top?mode=least_accepted` (RFC-69 R7): lowest accepted share first. @rfc RFC-69 R7 */
export const COVERAGE_TOP_LEAST_ACCEPTED: CoverageTraitRow[] = [
  COVERAGE_TRAIT_SEED_MASS,
  COVERAGE_TRAIT_SEXUAL_SYSTEM,
];

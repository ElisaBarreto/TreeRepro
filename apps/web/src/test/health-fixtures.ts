import {
  type HealthImport,
  healthImportSchema,
  type JobRunSummary,
  type PlatformHealth,
} from '@treerepro/contracts';
import { IMPORT_BATCH } from './dataset-fixtures.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Fourteen days ending today, oldest first, as RFC-52 R1's `byDay` orders
 * them. Relative to the real clock — like the job-run fixtures below, this
 * is never compared against a real wall-clock rule, but a hardcoded date
 * would still drift out of "the last 14 days" as a concept over time.
 */
function byDay(): PlatformHealth['activity']['byDay'] {
  const end = Date.now();
  return Array.from({ length: 14 }, (_, i) => ({
    day: new Date(end - (13 - i) * DAY_MS).toISOString().slice(0, 10),
    records: i,
    annotations: i % 3,
  }));
}

/**
 * A digest run that completed two hours ago: green per RFC-52 R3. Computed
 * relative to `Date.now()`, never a hardcoded date — `HealthPage` renders
 * `JobRow` without a `now` prop, so `jobBadge` compares this `startedAt`
 * against the real clock at render time, and a fixed past date would
 * eventually cross the 26-hour boundary and flip the badge from under the
 * test.
 * @rfc RFC-52 R1, R3
 */
export const JOB_RUN_HEALTHY: JobRunSummary = {
  startedAt: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
  finishedAt: new Date(Date.now() - 2 * HOUR_MS + 60_000).toISOString(),
  status: 'completed',
  detail: { recipients: 3 },
  error: null,
};

/**
 * A failed audit purge, thirty hours ago: red per RFC-52 R3 whatever its
 * age. Also clock-relative, for the same reason as `JOB_RUN_HEALTHY` — the
 * badge is red regardless of age here, but a hardcoded `startedAt` would
 * still make `formatDateTime(run.startedAt)` drift into an implausible
 * "future" relative to the real clock over time.
 * @rfc RFC-52 R1, R3
 */
export const JOB_RUN_FAILED: JobRunSummary = {
  startedAt: new Date(Date.now() - 30 * HOUR_MS).toISOString(),
  finishedAt: new Date(Date.now() - 30 * HOUR_MS + 5_000).toISOString(),
  status: 'failed',
  detail: {},
  error: 'Error ECONNREFUSED',
};

// The import fixture minus the one field the health payload drops.
const { runBy: _runBy, ...IMPORT_BATCH_WITHOUT_RUN_BY } = IMPORT_BATCH;

/**
 * `IMPORT_BATCH` as `GET /api/admin/health` answers it: the RFC-64 R11 item
 * without `runBy`, which is a person's name and so PII (RFC-52 R2).
 *
 * Derived from the import fixture rather than written out, so the two can
 * never drift, and pushed through `healthImportSchema` rather than merely
 * spread, so the SHAPE is enforced rather than asserted by a comment — a
 * strict schema rejects a stray `runBy` where TypeScript does not (its
 * excess-property check fires on fresh object literals only, and
 * `imports: [IMPORT_BATCH]` passed an identifier, which is how a person's
 * name reached a fixture of a payload that can never carry one).
 * @rfc RFC-52 R1, R2
 */
export const HEALTH_IMPORT: HealthImport = healthImportSchema.parse(IMPORT_BATCH_WITHOUT_RUN_BY);

/**
 * `GET /api/admin/health` on synthetic data with a populated grid.
 * @rfc RFC-52 R1
 */
export const PLATFORM_HEALTH: PlatformHealth = {
  users: { active: 12, invited: 2, suspended: 1, signedInLast7d: 9, signedInLast30d: 11 },
  dataset: {
    species: 100,
    activeSpecies: 90,
    traits: 20,
    activeTraits: 18,
    references: 300,
    records: 5000,
    coverageCells: 1200,
    validatedCells: 900,
  },
  activity: { records7d: 42, annotations7d: 8, proposals7d: 3, byDay: byDay() },
  queues: { pendingGroups: 4, contested: 1, proposals: 5 },
  jobs: { auditPurge: JOB_RUN_FAILED, digest: JOB_RUN_HEALTHY },
  imports: [HEALTH_IMPORT],
  computedAt: '2026-09-19T12:00:00.000Z',
};

/**
 * A fresh install: no cells anywhere and neither job has ever run. Ruling
 * R-C: both meters must read 0% and `—` rather than `NaN` or `Infinity`.
 * @rfc RFC-52 R1
 */
export const PLATFORM_HEALTH_EMPTY: PlatformHealth = {
  ...PLATFORM_HEALTH,
  dataset: {
    species: 0,
    activeSpecies: 0,
    traits: 0,
    activeTraits: 0,
    references: 0,
    records: 0,
    coverageCells: 0,
    validatedCells: 0,
  },
  jobs: { auditPurge: null, digest: null },
  imports: [],
};

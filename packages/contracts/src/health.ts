import { z } from 'zod';
import { importBatchSchema } from './dataset.ts';

/** @rfc RFC-10 R10 */
export const healthResponseSchema = z.strictObject({ ok: z.literal(true) });

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** `skipped` means the job decided there was nothing to do. @rfc RFC-74 R1 */
export const JOB_STATUSES = ['running', 'completed', 'failed', 'skipped'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const n = z.number().int().nonnegative();

/**
 * The newest `job_runs` row for one kind, as `platformHealthSchema` reports
 * it — `null` when the job has never run.
 * @rfc RFC-52 R1
 */
export const jobRunSummarySchema = z.strictObject({
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(JOB_STATUSES),
  detail: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
});

export type JobRunSummary = z.infer<typeof jobRunSummarySchema>;

/**
 * The RFC-64 R11 import batch item without `runBy` — a name is PII (R2).
 * @rfc RFC-52 R1, R2
 */
export const healthImportSchema = importBatchSchema.omit({ runBy: true });

export type HealthImport = z.infer<typeof healthImportSchema>;

/**
 * `GET /api/admin/health` (`health.read`): one global, viewer-independent
 * snapshot cached one minute in Redis under the key `health`.
 *
 * `dataset.records` is `sum(species_trait_coverage.record_count)`;
 * `dataset.references` is a flat count. `dataset.coverageCells` is the
 * number of species × trait cells with at least one record and
 * `dataset.acceptedCells` the number with an accepted value, so
 * `acceptedCells <= coverageCells <= activeSpecies * activeTraits`.
 * `activity.proposals7d` counts proposals created in the window;
 * `queues.proposals` counts open ones — two different numbers.
 * @rfc RFC-52 R1, R2
 */
export const platformHealthSchema = z.strictObject({
  users: z.strictObject({
    active: n,
    invited: n,
    suspended: n,
    signedInLast7d: n,
    signedInLast30d: n,
  }),
  dataset: z.strictObject({
    species: n,
    activeSpecies: n,
    traits: n,
    activeTraits: n,
    references: n,
    records: n,
    coverageCells: n,
    acceptedCells: n,
  }),
  activity: z.strictObject({
    records7d: n,
    annotations7d: n,
    proposals7d: n,
    byDay: z.array(z.strictObject({ day: z.iso.date(), records: n, annotations: n })).length(14),
  }),
  queues: z.strictObject({ pendingGroups: n, disputed: n, contested: n, proposals: n }),
  jobs: z.strictObject({
    auditPurge: jobRunSummarySchema.nullable(),
    digest: jobRunSummarySchema.nullable(),
  }),
  imports: z.array(healthImportSchema).max(5),
  computedAt: z.iso.datetime(),
});

export type PlatformHealth = z.infer<typeof platformHealthSchema>;

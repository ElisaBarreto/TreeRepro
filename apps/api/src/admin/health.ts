import type { HealthImport, JobRunSummary, PlatformHealth } from '@treerepro/contracts';
import { desc, type SQL, sql } from 'drizzle-orm';
import { UNRESTRICTED, type Visibility } from '../access/visibility.ts';
import { computeCoverageTotals } from '../dataset/coverage.ts';
import { toImportBatch } from '../dataset/import.ts';
import { countOpenProposals, countProposalsCreated } from '../dataset/proposals.ts';
import { countContested, countPendingGroups } from '../dataset/queues.ts';
import type { DbExecutor } from '../db/client.ts';
import { type ImportBatchRow, importBatches } from '../db/schema/imports.ts';
import type { JobRunRow } from '../db/schema/job-runs.ts';
import { latestRun } from '../jobs/runs.ts';
import { cachedJson } from '../redis/cache.ts';
import type { Redis } from '../redis/client.ts';

/** The db and cache the health page reads; deliberately narrower than `AuthContext`. */
type HealthContext = { db: DbExecutor; redis: Redis };

/** The payload of RFC-52 R1 without the `computedAt` of its entry. */
export type PlatformHealthValue = Omit<PlatformHealth, 'computedAt'>;

/** The sixty seconds of RFC-52 R1, and the one fixed key it stores under. */
const HEALTH_TTL_SECONDS = 60;
const HEALTH_KEY = 'health';

/** How many import batches RFC-52 R1 lists. */
const IMPORT_LIMIT = 5;

/**
 * The grid health measures coverage over: the ACTIVE catalog, the same for
 * every caller (RFC-52 R1).
 *
 * Deliberately NOT `UNRESTRICTED`. That visibility builds the grid over every
 * species and every trait, deactivated ones included, and `coverageCells` —
 * the cells holding at least one record — would then be bounded by
 * `species * traits` rather than by `activeSpecies * activeTraits`, the
 * denominator the health page reads it against. A deactivated species keeps
 * its records, so that is an ordinary state, not a corner case.
 *
 * The consequence is a documented one (RFC-52 R1): an admin holds
 * `dataset.read_inactive` and so sees the FULL grid on the coverage page,
 * whose totals therefore differ from these. The queue counters below stay
 * unrestricted — those are queues to work through, not a grid to fill.
 */
const ACTIVE_CATALOG: Visibility = { inactive: false, plotIds: null };

/** The activity window of RFC-52 R1, and the span `byDay` covers, in days. */
const ACTIVITY_WINDOW_DAYS = 7;
const BY_DAY_SPAN = 14;

const DAY_MS = 86_400_000;

interface UsersRow {
  active: number;
  invited: number;
  suspended: number;
}

interface SignInsRow {
  last_7d: number;
  last_30d: number;
}

interface DatasetRow {
  species: number;
  active_species: number;
  traits: number;
  active_traits: number;
  references: number;
  records: number;
}

interface ActivityRow {
  records_7d: number;
  annotations_7d: number;
}

interface ByDayRow {
  day: string;
  records: number;
  annotations: number;
}

/**
 * The newest run of a kind as RFC-52 R1 reports it; `null` when the job never
 * ran. `error` is published as stored: it is a failure code, never a message,
 * by `job_runs_error_check` (RFC-74 R1).
 */
function toJobRun(row: JobRunRow | null): JobRunSummary | null {
  if (row === null) return null;
  return {
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    detail: row.detail,
    error: row.error,
  };
}

/**
 * The RFC-64 R11 import item without `runBy`: a name is PII (RFC-52 R2). The
 * row is mapped through `toImportBatch` so the item can never drift from the
 * one `GET /api/imports` answers, and the user join that fills `runBy` is not
 * made at all rather than made and then discarded.
 */
function toHealthImport(row: ImportBatchRow): HealthImport {
  const { runBy: _runBy, ...rest } = toImportBatch(row, null);
  return rest;
}

/**
 * Runs a drizzle query builder now and hands back an ordinary promise.
 *
 * A builder is a LAZY thenable — `QueryPromise.then()` calls `execute()` — so
 * a builder awaited twice runs its statement twice. Every statement below is
 * awaited once in the `Promise.all` that keeps them concurrent and once more
 * where its result is read, so each must be a real, already-running promise
 * before that. The services (`countPendingGroups`, `latestRun`, …) are
 * ordinary async functions and need none of this; they go through here anyway
 * so that no reader has to know which of the fourteen is which.
 */
function started<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.resolve(query);
}

/**
 * Every number of RFC-52 R1, uncached, over any executor — a pool or a
 * transaction.
 *
 * It is exported, and not folded into `platformHealth`, for the reason
 * `computeDatasetStats` and `computeCoverageTotals` are: `health` is one fixed
 * key shared by every caller in a test run, so a test reading these numbers
 * through the cache would assert on whichever caller happened to compute the
 * entry. Its own integration test calls this function inside a rolled-back
 * `repeatable read` transaction and asserts deltas. Callers in the application
 * read the cached form.
 *
 * Nothing here is viewer-scoped and no number is gated on a permission,
 * because `health.read` is admin-only and one global payload is what makes a
 * single shared entry correct. The queue counters are asked for the
 * unrestricted visibility; the coverage totals are asked for `ACTIVE_CATALOG`,
 * for the reason given there — one scope each, the same for every caller.
 *
 * Every counter is the one that already exists — `countPendingGroups`,
 * `countContested`, `countOpenProposals`,
 * `countProposalsCreated`, `computeCoverageTotals`, `latestRun`,
 * `toImportBatch` — so no number in this payload carries a second definition.
 * @rfc RFC-52 R1, R2
 */
export async function computePlatformHealth(db: DbExecutor): Promise<PlatformHealthValue> {
  const end = new Date();
  const start7 = new Date(end.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS);
  const start30 = new Date(end.getTime() - 30 * DAY_MS);
  const within = (column: SQL): SQL =>
    sql`${column} > ${start7.toISOString()}::timestamptz
      and ${column} <= ${end.toISOString()}::timestamptz`;

  // Every statement is started here and awaited together below, so the
  // concurrency is exactly the `Promise.all` it always was — but each result
  // is named where it is produced rather than matched to a position in a
  // fourteen-long destructure, where inserting a statement anywhere but at
  // the end silently re-assigns every name after it.
  const usersP = started(
    db.execute(sql`
    select
      count(*) filter (where u.status = 'active')::int as active,
      count(*) filter (where u.status = 'invited')::int as invited,
      count(*) filter (where u.status = 'suspended')::int as suspended
    from users u`),
  ) as unknown as Promise<[UsersRow | undefined]>;

  // RFC-52 R1: distinct sign-ins over both windows in one statement. The
  // `at >` predicate is served by `audit_log_at_idx (at desc)`, which bounds
  // the scan to thirty days before the unindexed `action` filter applies.
  const signInsP = started(
    db.execute(sql`
    select
      count(distinct a.actor_user_id) filter (
        where a.at > ${start7.toISOString()}::timestamptz)::int as last_7d,
      count(distinct a.actor_user_id)::int as last_30d
    from audit_log a
    where a.action = 'auth.login.success'
      and a.at > ${start30.toISOString()}::timestamptz
      and a.at <= ${end.toISOString()}::timestamptz`),
  ) as unknown as Promise<[SignInsRow | undefined]>;

  // The same definitions `computeDatasetStats` gives these numbers
  // (RFC-72 R1): `records` is the stored coverage counter, never a scan of
  // `trait_records`, and `bibliographic_references` has no `active` column.
  const datasetP = started(
    db.execute(sql`
    select
      (select count(*)::int from species) as species,
      (select count(*)::int from species s where s.active) as active_species,
      (select count(*)::int from traits) as traits,
      (select count(*)::int from traits t where t.active) as active_traits,
      (select count(*)::int from bibliographic_references) as references,
      (select coalesce(sum(c.record_count), 0)::int from species_trait_coverage c)
        as records`),
  ) as unknown as Promise<[DatasetRow | undefined]>;

  const coverageP = started(computeCoverageTotals(db, ACTIVE_CATALOG));

  // RFC-52's Open questions: neither `trait_records` nor `record_annotations`
  // has an index on `created_at`, so this statement and `byDayP` below scan
  // both tables — about 3 ms each over the imported dataset when measured
  // (issue #116). Bounded by the sixty second cache entry and by the route
  // being admin-only; the follow-up if that stops being enough is an index on
  // each, which is a schema change, and the RFC names when to re-measure.
  const activityP = started(
    db.execute(sql`
    select
      (select count(*)::int from trait_records r where ${within(sql`r.created_at`)}) as records_7d,
      (select count(*)::int from record_annotations a where ${within(sql`a.created_at`)})
        as annotations_7d`),
  ) as unknown as Promise<[ActivityRow | undefined]>;

  // Fourteen rows always, ending today: the series is the left side, so a
  // day on which nothing happened is present with zeros rather than absent.
  const byDayP = started(
    db.execute(sql`
    select
      to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(r.n, 0)::int as records,
      coalesce(a.n, 0)::int as annotations
    from (
      select generate_series(
        current_date - ${BY_DAY_SPAN - 1}::int, current_date, interval '1 day')::date as day) d
    left join (
      select r.created_at::date as day, count(*)::int as n
      from trait_records r
      where r.created_at >= current_date - ${BY_DAY_SPAN - 1}::int
      group by 1) r on r.day = d.day
    left join (
      select a.created_at::date as day, count(*)::int as n
      from record_annotations a
      where a.created_at >= current_date - ${BY_DAY_SPAN - 1}::int
      group by 1) a on a.day = d.day
    order by d.day`),
  ) as unknown as Promise<ByDayRow[]>;

  // RFC-52 R1 / ruling R-H: proposals CREATED in the window, which is not
  // `openProposalsP` below.
  const proposals7dP = started(countProposalsCreated(db, { start: start7, end }));
  const pendingGroupsP = started(countPendingGroups(db, UNRESTRICTED));
  const contestedP = started(countContested(db, UNRESTRICTED));
  const openProposalsP = started(countOpenProposals(db));
  const digestRunP = started(latestRun(db, 'digest'));
  const auditPurgeRunP = started(latestRun(db, 'audit_purge'));
  const importRowsP = started(
    db.select().from(importBatches).orderBy(desc(importBatches.id)).limit(IMPORT_LIMIT),
  );

  await Promise.all([
    usersP,
    signInsP,
    datasetP,
    coverageP,
    activityP,
    byDayP,
    proposals7dP,
    pendingGroupsP,
    contestedP,
    openProposalsP,
    digestRunP,
    auditPurgeRunP,
    importRowsP,
  ]);

  const [users] = await usersP;
  const [signIns] = await signInsP;
  const [dataset] = await datasetP;
  const coverage = await coverageP;
  const [activity] = await activityP;
  const byDay = await byDayP;
  const proposals7d = await proposals7dP;
  const pendingGroups = await pendingGroupsP;
  const contested = await contestedP;
  const openProposals = await openProposalsP;
  const digestRun = await digestRunP;
  const auditPurgeRun = await auditPurgeRunP;
  const importRows = await importRowsP;

  return {
    users: {
      active: users?.active ?? 0,
      invited: users?.invited ?? 0,
      suspended: users?.suspended ?? 0,
      signedInLast7d: signIns?.last_7d ?? 0,
      signedInLast30d: signIns?.last_30d ?? 0,
    },
    dataset: {
      species: dataset?.species ?? 0,
      activeSpecies: dataset?.active_species ?? 0,
      traits: dataset?.traits ?? 0,
      activeTraits: dataset?.active_traits ?? 0,
      references: dataset?.references ?? 0,
      records: dataset?.records ?? 0,
      // RFC-52 R1: the cells that hold data and the cells with a validated
      // record — not `cells`, which is the grid size by definition.
      coverageCells: coverage.withData,
      validatedCells: coverage.validated,
    },
    activity: {
      records7d: activity?.records_7d ?? 0,
      annotations7d: activity?.annotations_7d ?? 0,
      proposals7d,
      byDay: byDay.map((row) => ({
        day: row.day,
        records: row.records,
        annotations: row.annotations,
      })),
    },
    queues: { pendingGroups, contested, proposals: openProposals },
    jobs: { auditPurge: toJobRun(auditPurgeRun), digest: toJobRun(digestRun) },
    imports: importRows.map(toHealthImport),
  };
}

/**
 * `computePlatformHealth` behind the one-minute entry RFC-52 R1 names,
 * `health`. The key carries no viewer class because the payload carries no
 * viewer: every caller of this route holds `health.read` and reads the same
 * numbers, so one entry is correct for all of them, and `computedAt` is the
 * entry's own.
 * @rfc RFC-52 R1
 */
export async function platformHealth(ctx: HealthContext): Promise<PlatformHealth> {
  const { value, computedAt } = await cachedJson(ctx.redis, HEALTH_KEY, HEALTH_TTL_SECONDS, () =>
    computePlatformHealth(ctx.db),
  );
  return { ...value, computedAt };
}

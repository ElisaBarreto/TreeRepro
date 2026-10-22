import { sql } from 'drizzle-orm';
import type { Visibility } from '../access/visibility.ts';
import { continuousSummaries, countedRecordsSql } from '../dataset/species-summary.ts';
import type { Db } from '../db/client.ts';
import { failureCode, sanitizeError } from '../http/errors.ts';
import type { Logger } from '../logger.ts';
import { finishRun, latestRun, startRun } from './runs.ts';

/** R12's session advisory lock; fixed, so the timer and the command exclude each other. @rfc RFC-78 R12 */
export const SNAPSHOT_LOCK_KEY = 4665;

/** A completed snapshot younger than this makes the timer wait. @rfc RFC-78 R12 */
export const SNAPSHOT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** How often the timer wakes up, and its first delay after start-up. @rfc RFC-78 R12 */
const SNAPSHOT_TICK_MS = 60 * 60 * 1000;
const SNAPSHOT_FIRST_TICK_MS = 60 * 1000;

/**
 * The records every signed-in viewer reads (R8): no inactive species, trait
 * or level, harmonised only, and no plot restriction (maps are global).
 */
const EVERY_VIEWER: Visibility = { inactive: false, plotIds: null, review: false };

/** Due with no completed snapshot, or when the last one finished 7 days ago or more. @rfc RFC-78 R12 */
export function isSnapshotDue(lastCompletedAt: Date | null, now: Date): boolean {
  return (
    lastCompletedAt === null || now.getTime() - lastCompletedAt.getTime() >= SNAPSHOT_INTERVAL_MS
  );
}

/** The outcome of one call. @rfc RFC-78 R12 */
export interface SnapshotResult {
  runId: string | null;
  status: 'completed' | 'skipped' | 'not_due';
  counts?: { completeness: number; continuous: number; categorical: number };
}

/**
 * Computes the region tables of R9–R11 and replaces them, with
 * `region_snapshot`, in one transaction. `onlyIfDue` (the timer) returns
 * `not_due`, recording nothing, while a completed snapshot is younger than 7
 * days; the command runs regardless. A run that finds R12's lock held is
 * recorded `skipped`.
 * @rfc RFC-78 R8, R9, R10, R11, R12
 */
export async function runSnapshot(input: {
  db: Db;
  now?: Date;
  onlyIfDue?: boolean;
}): Promise<SnapshotResult> {
  const { db } = input;
  const now = input.now ?? new Date();
  if (input.onlyIfDue) {
    const last = await latestRun(db, 'snapshot', ['completed']);
    if (!isSnapshotDue(last?.finishedAt ?? null, now)) return { runId: null, status: 'not_due' };
  }
  // The run is opened before the lock is taken, so a failure to open it can
  // never leave the session lock held on a connection returned to the pool.
  const runId = await startRun(db, 'snapshot');
  const lock = await db.$client.reserve();
  try {
    const [{ locked }] =
      (await lock`select pg_try_advisory_lock(${SNAPSHOT_LOCK_KEY}) as locked`) as [
        { locked: boolean },
      ];
    if (!locked) {
      await finishRun(db, runId, { status: 'skipped', detail: { reason: 'locked' } });
      return { runId, status: 'skipped' };
    }
    try {
      const counts = await writeSnapshot(db, now);
      await finishRun(db, runId, { status: 'completed', detail: { ...counts } });
      return { runId, status: 'completed', counts };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await finishRun(db, runId, { status: 'failed', error: failureCode(error) }).catch(
        () => undefined,
      );
      throw error;
    } finally {
      await lock`select pg_advisory_unlock(${SNAPSHOT_LOCK_KEY})`;
    }
  } finally {
    lock.release();
  }
}

/** R9–R11 in one transaction, replacing the previous snapshot. */
async function writeSnapshot(
  db: Db,
  now: Date,
): Promise<{ completeness: number; continuous: number; categorical: number }> {
  // R8: one statement over every species (RFC-77 R5), outside the write.
  const medians = (await continuousSummaries(db, EVERY_VIEWER, null))
    .filter((row) => row.speciesMedian !== null)
    .map((row) => ({
      species_id: row.speciesId,
      trait_id: row.traitId,
      median: row.speciesMedian,
    }));
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`create temporary table snap_medians (species_id uuid, trait_id uuid, median float8) on commit drop`,
    );
    await tx.execute(sql`
      insert into snap_medians
      select * from json_to_recordset(${JSON.stringify(medians)}::json)
        as x(species_id uuid, trait_id uuid, median float8)`);
    // R8: which states each species holds; their counts do not matter here.
    await tx.execute(sql`
      create temporary table snap_states on commit drop as
      select distinct r.species_id, r.trait_id, r.level_id
      from (${countedRecordsSql(EVERY_VIEWER, 'categorical', null)}) r
      where r.level_id is not null`);
    await tx.execute(sql`
      create temporary table snap_regions on commit drop as
      select m.species_id, d.area_code_l3
      from wcvp_species_match m join wcvp_distribution d using (plant_name_id)`);
    await tx.execute(sql`
      create temporary table snap_denominators on commit drop as
      select d.area_code_l3, count(*)::int as wcvp_species,
        count(*) filter (where w.is_tree)::int as wcvp_tree_species
      from wcvp_distribution d join wcvp_species w using (plant_name_id)
      group by d.area_code_l3`);
    await tx.execute(sql`delete from region_completeness`);
    await tx.execute(sql`delete from region_continuous`);
    await tx.execute(sql`delete from region_categorical`);
    const completeness = await tx.execute(sql`
      insert into region_completeness (trait_id, area_code_l3, species_with_data, wcvp_species, wcvp_tree_species)
      select p.trait_id, r.area_code_l3, count(distinct p.species_id)::int, d.wcvp_species, d.wcvp_tree_species
      from (select species_id, trait_id from snap_medians
            union select species_id, trait_id from snap_states) p
      join snap_regions r using (species_id)
      join snap_denominators d using (area_code_l3)
      group by p.trait_id, r.area_code_l3, d.wcvp_species, d.wcvp_tree_species`);
    const continuous = await tx.execute(sql`
      insert into region_continuous (trait_id, area_code_l3, n_species, mean, sd, median, min, max, cv)
      select m.trait_id, r.area_code_l3, count(*)::int, avg(m.median), stddev_samp(m.median),
        percentile_cont(0.5) within group (order by m.median), min(m.median), max(m.median),
        case when avg(m.median) > 0 and stddev_samp(m.median) is not null
             then 100 * stddev_samp(m.median) / avg(m.median) end
      from snap_medians m join snap_regions r using (species_id)
      group by m.trait_id, r.area_code_l3`);
    const categorical = await tx.execute(sql`
      with held as (
        select s.species_id, s.trait_id, s.level_id, r.area_code_l3
        from snap_states s join snap_regions r using (species_id)),
      per_trait as (
        select trait_id, area_code_l3, count(distinct species_id)::int as n
        from held group by trait_id, area_code_l3)
      insert into region_categorical (trait_id, level_id, area_code_l3, n_species_with_level, n_species_with_trait)
      select h.trait_id, h.level_id, h.area_code_l3, count(distinct h.species_id)::int, t.n
      from held h join per_trait t using (trait_id, area_code_l3)
      group by h.trait_id, h.level_id, h.area_code_l3, t.n`);
    await tx.execute(sql`
      insert into region_snapshot (id, computed_at) values (true, ${now.toISOString()}::timestamptz)
      on conflict (id) do update set computed_at = excluded.computed_at`);
    return {
      completeness: completeness.count ?? 0,
      continuous: continuous.count ?? 0,
      categorical: categorical.count ?? 0,
    };
  });
}

/**
 * Ticks hourly, the first time a minute after start-up, and runs the snapshot
 * when it is due (R12). A failure is logged, never thrown; both handles are
 * unref'd and `stop()` clears them, as `startDigestTimer` does (RFC-74 R2).
 * @rfc RFC-78 R12
 */
export function startSnapshotTimer(deps: {
  db: Db;
  logger: Logger;
  intervalMs?: number;
  initialDelayMs?: number;
}): { stop(): void } {
  let interval: ReturnType<typeof setInterval> | undefined;
  const tick = async (): Promise<void> => {
    try {
      const result = await runSnapshot({ db: deps.db, onlyIfDue: true });
      if (result.status === 'not_due')
        deps.logger.debug({ status: result.status }, 'snapshot tick');
      else deps.logger.info({ ...result }, 'snapshot run');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      deps.logger.error({ err: sanitizeError(error) }, 'snapshot run failed');
    }
  };
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), deps.intervalMs ?? SNAPSHOT_TICK_MS);
    interval.unref();
  }, deps.initialDelayMs ?? SNAPSHOT_FIRST_TICK_MS);
  first.unref();
  return {
    stop() {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}

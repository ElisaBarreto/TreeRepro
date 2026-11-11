import { PLATFORMS, type Platform } from '@treerepro/contracts';
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
 * The records every signed-in viewer of `platform` reads (R8): its species
 * scope, no inactive species, trait or level, harmonised only, and no plot
 * restriction (maps are global).
 */
function everyViewer(platform: Platform): Visibility {
  return { inactive: false, plotIds: null, review: false, platform };
}

/** One platform's row counts of R9–R11. @rfc RFC-78 R12 */
export interface SnapshotCounts {
  completeness: number;
  continuous: number;
  categorical: number;
}

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
  counts?: Record<Platform, SnapshotCounts>;
}

/**
 * Computes the region tables of R9–R11 for every platform and replaces them, with
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

/** R9–R11 of every platform in one transaction, replacing the previous snapshot. */
async function writeSnapshot(db: Db, now: Date): Promise<Record<Platform, SnapshotCounts>> {
  // R8: one statement per platform over its species (RFC-77 R5), outside the write.
  const medians: { platform: Platform; species_id: string; trait_id: string; median: number }[] =
    [];
  for (const platform of PLATFORMS) {
    for (const row of await continuousSummaries(db, everyViewer(platform), null)) {
      if (row.speciesMedian === null) continue;
      medians.push({
        platform,
        species_id: row.speciesId,
        trait_id: row.traitId,
        median: row.speciesMedian,
      });
    }
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`create temporary table snap_medians (platform text, species_id uuid, trait_id uuid, median float8) on commit drop`,
    );
    await tx.execute(sql`
      insert into snap_medians
      select * from json_to_recordset(${JSON.stringify(medians)}::json)
        as x(platform text, species_id uuid, trait_id uuid, median float8)`);
    // R8: which states each species holds on each platform; their counts do not matter here.
    await tx.execute(sql`
      create temporary table snap_states on commit drop as
      ${sql.join(
        PLATFORMS.map(
          (platform) => sql`
            select distinct ${platform}::text as platform, r.species_id, r.trait_id, r.level_id
            from (${countedRecordsSql(everyViewer(platform), 'categorical', null)}) r
            where r.level_id is not null`,
        ),
        sql` union all `,
      )}`);
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
    await tx.execute(sql`delete from region_snapshot`);
    await tx.execute(sql`
      insert into region_completeness (platform, trait_id, area_code_l3, species_with_data, wcvp_species, wcvp_tree_species)
      select p.platform, p.trait_id, r.area_code_l3, count(distinct p.species_id)::int, d.wcvp_species, d.wcvp_tree_species
      from (select platform, species_id, trait_id from snap_medians
            union select platform, species_id, trait_id from snap_states) p
      join snap_regions r using (species_id)
      join snap_denominators d using (area_code_l3)
      group by p.platform, p.trait_id, r.area_code_l3, d.wcvp_species, d.wcvp_tree_species`);
    await tx.execute(sql`
      insert into region_continuous (platform, trait_id, area_code_l3, n_species, mean, sd, median, min, max, cv)
      select m.platform, m.trait_id, r.area_code_l3, count(*)::int, avg(m.median), stddev_samp(m.median),
        percentile_cont(0.5) within group (order by m.median), min(m.median), max(m.median),
        case when avg(m.median) > 0 and stddev_samp(m.median) is not null
             then 100 * stddev_samp(m.median) / avg(m.median) end
      from snap_medians m join snap_regions r using (species_id)
      group by m.platform, m.trait_id, r.area_code_l3`);
    await tx.execute(sql`
      with held as (
        select s.platform, s.species_id, s.trait_id, s.level_id, r.area_code_l3
        from snap_states s join snap_regions r using (species_id)),
      per_trait as (
        select platform, trait_id, area_code_l3, count(distinct species_id)::int as n
        from held group by platform, trait_id, area_code_l3)
      insert into region_categorical (platform, trait_id, level_id, area_code_l3, n_species_with_level, n_species_with_trait)
      select h.platform, h.trait_id, h.level_id, h.area_code_l3, count(distinct h.species_id)::int, t.n
      from held h join per_trait t using (platform, trait_id, area_code_l3)
      group by h.platform, h.trait_id, h.level_id, h.area_code_l3, t.n`);
    const counts = {} as Record<Platform, SnapshotCounts>;
    for (const platform of PLATFORMS) {
      await tx.execute(sql`
        insert into region_snapshot (platform, computed_at)
        values (${platform}, ${now.toISOString()}::timestamptz)`);
      const [row] = (await tx.execute(sql`
        select (select count(*) from region_completeness where platform = ${platform})::int as completeness,
          (select count(*) from region_continuous where platform = ${platform})::int as continuous,
          (select count(*) from region_categorical where platform = ${platform})::int as categorical`)) as unknown as [
        SnapshotCounts,
      ];
      counts[platform] = row;
    }
    return counts;
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

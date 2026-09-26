import { type SQL, sql } from 'drizzle-orm';
import {
  levelVisible,
  speciesVisible,
  traitVisible,
  type Visibility,
} from '../access/visibility.ts';
import type { contests } from '../db/schema/contests.ts';
import { liveSql, recordVisible } from './records.ts';

/*
 * The derived contest states of RFC-63 R14, as SQL fragments over the four
 * contest tables. Every caller — record items, the trait summary, the review
 * filter, and later the contested queue, the dashboard and the digest —
 * builds on these, so "contested" has one definition.
 *
 * Two kinds of parameter:
 * - `k` names a `contests` alias in the caller's query. It is interpolated
 *   raw, so it is always a code constant, never input.
 * - `speciesId`, `traitId`, `levelId`, `recordId` are SQL fragments (a column
 *   reference such as sql`r.id`, or a bound parameter).
 * Each fragment uses its own internal aliases, prefixed per helper, so
 * fragments nest without shadowing one another.
 */

/**
 * A record of `speciesId` × `traitId` on `levelId` that the viewer can see:
 * its species, trait and level are visible and it is live (RFC-33 R2).
 */
function visibleRecordOfLevel(v: Visibility, speciesId: SQL, traitId: SQL, levelId: SQL): SQL {
  return sql`exists (select 1 from trait_records vl_r
    join species vl_s on vl_s.id = vl_r.species_id
    join traits vl_t on vl_t.id = vl_r.trait_id
    where vl_r.species_id = ${speciesId} and vl_r.trait_id = ${traitId} and vl_r.level_id = ${levelId}
      and ${speciesVisible(v, sql`vl_s.active`, sql`vl_s.id`)}
      and ${traitVisible(v, sql`vl_t.active`)}
      and ${recordVisible(v, sql`vl_r.id`, sql`vl_r.harmonisation`)})`;
}

/**
 * The record `recordId` is visible to the viewer, species and trait included.
 * @rfc RFC-33 R2
 */
export function recordFullyVisible(v: Visibility, recordId: SQL): SQL {
  return sql`exists (select 1 from trait_records fv_r
    join species fv_s on fv_s.id = fv_r.species_id
    join traits fv_t on fv_t.id = fv_r.trait_id
    where fv_r.id = ${recordId}
      and ${speciesVisible(v, sql`fv_s.active`, sql`fv_s.id`)}
      and ${traitVisible(v, sql`fv_t.active`)}
      and ${recordVisible(v, sql`fv_r.id`, sql`fv_r.harmonisation`)})`;
}

/**
 * Contest `k` is withdrawn: it has a `withdraw` event, or it created records
 * and every one of them has a `withdraw` annotation. Viewer-blind.
 * @param k a `contests` alias (code constant)
 * @rfc RFC-63 R14
 */
export function contestWithdrawnSql(k: string): SQL {
  const id = sql.raw(`${k}.id`);
  return sql`(exists (select 1 from contest_events cw_e where cw_e.contest_id = ${id} and cw_e.kind = 'withdraw')
    or (exists (select 1 from contest_records cw_r where cw_r.contest_id = ${id})
      and not exists (select 1 from contest_records cw_l where cw_l.contest_id = ${id}
        and ${liveSql(sql`cw_l.record_id`)})))`;
}

/**
 * Contest `k` is resolved: it carries Keep both (a `resolve` event). Viewer-blind.
 * @param k a `contests` alias (code constant)
 * @rfc RFC-63 R14
 */
export function contestResolvedSql(k: string): SQL {
  return sql`exists (select 1 from contest_events cr_e
    where cr_e.contest_id = ${sql.raw(`${k}.id`)} and cr_e.kind = 'resolve')`;
}

/**
 * Contest `k` is standing for the viewer: neither withdrawn nor resolved, and
 * at least one level it names has a record the viewer can see (categorical),
 * or the record it responds to is visible (quantitative).
 * @param v the viewer
 * @param k a `contests` alias (code constant)
 * @rfc RFC-63 R14
 */
export function contestStandingSql(v: Visibility, k: string): SQL {
  const col = (c: string) => sql.raw(`${k}.${c}`);
  return sql`(not ${contestWithdrawnSql(k)} and not ${contestResolvedSql(k)} and (
    exists (select 1 from contest_levels st_l where st_l.contest_id = ${col('id')}
      and ${visibleRecordOfLevel(v, col('species_id'), col('trait_id'), sql`st_l.level_id`)})
    or exists (select 1 from contest_records st_c
      join trait_records st_r on st_r.id = st_c.record_id
      where st_c.contest_id = ${col('id')} and st_r.responds_to_record_id is not null
        and ${recordFullyVisible(v, sql`st_r.responds_to_record_id`)})))`;
}

/**
 * Level `levelId` of `speciesId` × `traitId` is contested for the viewer: it
 * has a visible record and a contest of the same species × trait that is
 * neither withdrawn nor resolved names it (such a contest is then standing).
 * @param v the viewer
 * @rfc RFC-63 R14
 */
export function levelContestedSql(v: Visibility, speciesId: SQL, traitId: SQL, levelId: SQL): SQL {
  return sql`(exists (select 1 from contests lc_k
      join contest_levels lc_l on lc_l.contest_id = lc_k.id
      where lc_k.species_id = ${speciesId} and lc_k.trait_id = ${traitId} and lc_l.level_id = ${levelId}
        and not ${contestWithdrawnSql('lc_k')} and not ${contestResolvedSql('lc_k')})
    and ${visibleRecordOfLevel(v, speciesId, traitId, levelId)})`;
}

/**
 * Record `recordId` is contested for the viewer: its level is contested
 * (categorical), or it is visible and a standing contest responds to it
 * (quantitative: the contest's record has `responds_to_record_id` = it).
 * @param v the viewer
 * @rfc RFC-63 R6, R14
 */
export function recordContestedSql(v: Visibility, recordId: SQL): SQL {
  return sql`(exists (select 1 from trait_records rc_r where rc_r.id = ${recordId}
      and rc_r.level_id is not null
      and ${levelContestedSql(v, sql`rc_r.species_id`, sql`rc_r.trait_id`, sql`rc_r.level_id`)})
    or (exists (select 1 from trait_records rq_r
        join contest_records rq_c on rq_c.record_id = rq_r.id
        join contests rq_k on rq_k.id = rq_c.contest_id
        where rq_r.responds_to_record_id = ${recordId} and rq_r.intent = 'contest'
          and not ${contestWithdrawnSql('rq_k')} and not ${contestResolvedSql('rq_k')})
      and ${recordFullyVisible(v, recordId)}))`;
}

/**
 * Distinct authors of the contests that are not withdrawn (resolved ones
 * included) and name `recordId`'s level for its species × trait, or respond
 * to `recordId` (quantitative). Viewer-blind.
 * @rfc RFC-63 R8, R14
 */
export function contestCountSql(recordId: SQL): SQL<number> {
  return sql<number>`(select count(distinct cc_k.created_by) from trait_records cc_t
    join contests cc_k on cc_k.species_id = cc_t.species_id and cc_k.trait_id = cc_t.trait_id
    where cc_t.id = ${recordId} and not ${contestWithdrawnSql('cc_k')}
      and (exists (select 1 from contest_levels cc_l
          where cc_l.contest_id = cc_k.id and cc_l.level_id = cc_t.level_id)
        or exists (select 1 from contest_records cc_c
          join trait_records cc_q on cc_q.id = cc_c.record_id
          where cc_c.contest_id = cc_k.id and cc_q.responds_to_record_id = cc_t.id)))::int`;
}

/**
 * The contest `contestIdCol` is visible to the viewer: its species and trait
 * are visible, and every level it names is visible too — none for a
 * quantitative contest, which is then vacuously true (RFC-33 R2). The
 * contested queue, its count and the contributions list all apply it.
 * @param contestIdCol a `contests.id` reference in the caller's query
 * @rfc RFC-65 R10, R16
 * @rfc RFC-33 R2
 */
export function contestVisibleSql(v: Visibility, contestIdCol: SQL | typeof contests.id): SQL {
  return sql`(exists (select 1 from contests cv_k
      join species cv_s on cv_s.id = cv_k.species_id
      join traits cv_t on cv_t.id = cv_k.trait_id
      where cv_k.id = ${contestIdCol}
        and ${speciesVisible(v, sql`cv_s.active`, sql`cv_s.id`)}
        and ${traitVisible(v, sql`cv_t.active`)})
    and not exists (select 1 from contest_levels cv_l
      join trait_levels cv_lvl on cv_lvl.id = cv_l.level_id
      where cv_l.contest_id = ${contestIdCol} and not ${levelVisible(v, sql`cv_lvl.active`)}))`;
}

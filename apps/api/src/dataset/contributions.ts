import type {
  ContributionAnnotation,
  ContributionRecord,
  ContributionSummary,
  ListContributionsQuery,
  RecordItem,
} from '@treerepro/contracts';
import { and, count, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  levelVisible,
  speciesVisible,
  traitVisible,
  type Visibility,
} from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { contestEvents, contestLevels, contestRecords, contests } from '../db/schema/contests.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import { decodeCursor, encodeCursor, pageOf } from '../http/cursor.ts';
import { contestWithdrawnSql } from './contests.ts';
import { itemQuery, liveSql, reviewStatusSql, toItem } from './records.ts';

const annotationRefObserver = alias(users, 'annotation_ref_observer');

const DAY_MS = 24 * 60 * 60 * 1000;

/** `from` and `to` are inclusive day bounds in UTC (RFC-71 R1). */
const dayStart = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
const dayAfter = (isoDate: string) => new Date(dayStart(isoDate).getTime() + DAY_MS);

/** Records responding to this one (RFC-70 R1). */
function responseCountSql(recordId: SQL): SQL<number> {
  return sql<number>`(select count(*) from ${traitRecords} x
    where x.responds_to_record_id = ${recordId})::int`;
}

/**
 * The filters of RFC-71 R1, all of them predicates on the record: for
 * `kind=annotations` they apply to the annotated record (R3).
 */
function recordFilters(visibility: Visibility, input: ListContributionsQuery): SQL[] {
  const conditions: SQL[] = [];
  if (input.traitId) conditions.push(eq(traitRecords.traitId, input.traitId));
  if (input.speciesId) conditions.push(eq(traitRecords.speciesId, input.speciesId));
  if (input.review) {
    conditions.push(sql`${reviewStatusSql(visibility, traitRecords.id)} = ${input.review}`);
  }
  if (input.intent) {
    conditions.push(
      input.intent === 'none' ? isNull(traitRecords.intent) : eq(traitRecords.intent, input.intent),
    );
  }
  if (input.from) conditions.push(gte(traitRecords.createdAt, dayStart(input.from)));
  if (input.to) conditions.push(lt(traitRecords.createdAt, dayAfter(input.to)));
  return conditions;
}

/**
 * `responseCount` for one page of records. It is read separately because
 * {@link itemQuery}'s selection is fixed, and keeping it that way is what
 * lets every record item in the API share one join.
 */
async function responseCounts(db: DbExecutor, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: traitRecords.id,
      responseCount: responseCountSql(sql`${traitRecords.id}`).as('response_count'),
    })
    .from(traitRecords)
    .where(inArray(traitRecords.id, ids));
  return new Map(rows.map((r) => [r.id, r.responseCount]));
}

/** @rfc RFC-71 R2 */
async function listRecordContributions(
  db: DbExecutor,
  visibility: Visibility,
  userId: string,
  input: ListContributionsQuery & { limit: number },
): Promise<{ data: ContributionRecord[]; nextCursor: string | null }> {
  const conditions: SQL[] = [
    eq(traitRecords.createdBy, userId),
    eq(traitRecords.origin, 'manual'),
    speciesVisible(visibility),
    traitVisible(visibility),
    liveSql(traitRecords.id),
    ...recordFilters(visibility, input),
  ];
  if (input.cursor) conditions.push(lt(traitRecords.id, decodeCursor(input.cursor)));
  const rows = await itemQuery(db, visibility)
    .where(and(...conditions))
    .orderBy(desc(traitRecords.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.record.id));
  const counts = await responseCounts(
    db,
    page.map((r) => r.record.id),
  );
  const data = page.map((r) => ({
    ...toItem(r),
    responseCount: counts.get(r.record.id) ?? 0,
  }));
  return { data, nextCursor };
}

/**
 * The first record a contest created, by `record_code`, when it is visible
 * to the viewer (species, trait and live, as elsewhere in this module);
 * `null` when it created none, or when that first record is not visible.
 * `contestIdCol` is a `contests.id` reference in the caller's query.
 * @rfc RFC-71 R3
 * @rfc RFC-63 R14
 */
function firstVisibleContestRecordIdSql(
  v: Visibility,
  contestIdCol: SQL | typeof contests.id,
): SQL<string | null> {
  const first = sql`(select fcr_r.id from ${traitRecords} fcr_r
    join ${contestRecords} fcr_c on fcr_c.record_id = fcr_r.id
    where fcr_c.contest_id = ${contestIdCol}
    order by fcr_r.record_code asc limit 1)`;
  return sql<string | null>`(select fcv_r.id from ${traitRecords} fcv_r
    join ${species} fcv_s on fcv_s.id = fcv_r.species_id
    join ${traits} fcv_t on fcv_t.id = fcv_r.trait_id
    where fcv_r.id = ${first}
      and ${speciesVisible(v, sql`fcv_s.active`, sql`fcv_s.id`)}
      and ${traitVisible(v, sql`fcv_t.active`)}
      and ${liveSql(sql`fcv_r.id`)})`;
}

/**
 * The contest `contestIdCol` is visible to the viewer: its species and trait
 * are visible, and every level it names (RFC-63 R14's `contest_levels`) is
 * visible too — none for a quantitative contest, which is then vacuously
 * true. Mirrors the check the contested queue will apply to a contest row
 * (RFC-33 R2, R3; RFC-65 R16).
 */
function contestVisibleSql(v: Visibility, contestIdCol: SQL | typeof contests.id): SQL {
  return sql`(exists (select 1 from ${contests} cv_k
      join ${species} cv_s on cv_s.id = cv_k.species_id
      join ${traits} cv_t on cv_t.id = cv_k.trait_id
      where cv_k.id = ${contestIdCol}
        and ${speciesVisible(v, sql`cv_s.active`, sql`cv_s.id`)}
        and ${traitVisible(v, sql`cv_t.active`)})
    and not exists (select 1 from ${contestLevels} cv_l
      join ${traitLevels} cv_lvl on cv_lvl.id = cv_l.level_id
      where cv_l.contest_id = ${contestIdCol} and not ${levelVisible(v, sql`cv_lvl.active`)}))`;
}

/** One page of the viewer's Keep-both resolutions (RFC-71 R3, RFC-65 R16). */
async function listResolutions(
  db: DbExecutor,
  visibility: Visibility,
  userId: string,
  input: ListContributionsQuery & { limit: number },
  cursorId: string | undefined,
): Promise<{ id: string; createdAt: Date; recordId: string | null }[]> {
  const recordIdSql = firstVisibleContestRecordIdSql(visibility, contests.id);
  const conditions: SQL[] = [
    eq(contestEvents.actorId, userId),
    eq(contestEvents.kind, 'resolve'),
    // A resolution on a contest the viewer cannot see (its species, trait,
    // or a level it names) is omitted outright (RFC-33 R2, R3; RFC-65 R16),
    // regardless of whether the contest created a visible record.
    contestVisibleSql(visibility, contests.id),
  ];
  // RFC-71 R3: speciesId/traitId name the contest's own species and trait;
  // review and intent read the resolution's record and exclude it when that
  // record is null (no record, or one the viewer cannot see). from/to bound
  // the resolution event's own date (controller ruling): a record-less
  // resolution is still listable by date, unlike review/intent which have
  // nothing to read without a record.
  if (input.traitId) conditions.push(eq(contests.traitId, input.traitId));
  if (input.speciesId) conditions.push(eq(contests.speciesId, input.speciesId));
  if (input.review) {
    conditions.push(
      sql`${recordIdSql} is not null and ${reviewStatusSql(visibility, recordIdSql)} = ${input.review}`,
    );
  }
  if (input.intent) {
    conditions.push(
      input.intent === 'none'
        ? sql`${recordIdSql} is not null and exists (select 1 from ${traitRecords} lr_i where lr_i.id = ${recordIdSql} and lr_i.intent is null)`
        : sql`${recordIdSql} is not null and exists (select 1 from ${traitRecords} lr_i where lr_i.id = ${recordIdSql} and lr_i.intent = ${input.intent})`,
    );
  }
  if (input.from) conditions.push(gte(contestEvents.createdAt, dayStart(input.from)));
  if (input.to) conditions.push(lt(contestEvents.createdAt, dayAfter(input.to)));
  if (cursorId) conditions.push(lt(contestEvents.id, cursorId));
  return db
    .select({
      id: contestEvents.id,
      createdAt: contestEvents.createdAt,
      recordId: recordIdSql.as('record_id'),
    })
    .from(contestEvents)
    .innerJoin(contests, eq(contests.id, contestEvents.contestId))
    .where(and(...conditions))
    .orderBy(desc(contestEvents.id))
    .limit(input.limit + 1);
}

type MergedAnnotationRow = {
  id: string;
  kind: 'confirm' | 'resolve';
  note: string | null;
  generated: boolean;
  createdAt: Date;
  recordId: string | null;
  referenceId: string | null;
  citationKey: string | null;
  referenceKind: (typeof bibliographicReferences.$inferSelect)['kind'] | null;
  referenceObserverId: string | null;
  referenceObserverName: string | null;
  shortCitation: string | null;
};

/**
 * `kind=annotations`: the viewer's `confirm` annotations on visible records,
 * unioned with their Keep-both resolutions (`contest_events` rows of kind
 * `resolve`, never stored in `record_annotations`), newest first on a keyset
 * cursor across both sources — both primary keys are uuidv7, so comparing
 * them directly orders the merge. `withdraw`, `dispute` and `neutral` rows
 * are never listed.
 * @rfc RFC-71 R3
 * @rfc RFC-65 R16
 */
async function listAnnotationContributions(
  db: DbExecutor,
  visibility: Visibility,
  userId: string,
  input: ListContributionsQuery & { limit: number },
): Promise<{ data: ContributionAnnotation[]; nextCursor: string | null }> {
  const cursorId = input.cursor ? decodeCursor(input.cursor) : undefined;

  const confirmConditions: SQL[] = [
    eq(recordAnnotations.actorId, userId),
    eq(recordAnnotations.kind, 'confirm'),
    speciesVisible(visibility),
    traitVisible(visibility),
    liveSql(traitRecords.id),
    ...recordFilters(visibility, input),
  ];
  if (cursorId) confirmConditions.push(lt(recordAnnotations.id, cursorId));
  const confirmRows = await db
    .select({
      id: recordAnnotations.id,
      recordId: recordAnnotations.recordId,
      note: recordAnnotations.note,
      generated: recordAnnotations.generated,
      createdAt: recordAnnotations.createdAt,
      referenceId: bibliographicReferences.id,
      citationKey: bibliographicReferences.citationKey,
      referenceKind: bibliographicReferences.kind,
      referenceObserverId: annotationRefObserver.id,
      referenceObserverName: annotationRefObserver.name,
      shortCitation: bibliographicReferences.shortCitation,
    })
    .from(recordAnnotations)
    .innerJoin(traitRecords, eq(traitRecords.id, recordAnnotations.recordId))
    .innerJoin(species, eq(species.id, traitRecords.speciesId))
    .innerJoin(traits, eq(traits.id, traitRecords.traitId))
    .leftJoin(
      bibliographicReferences,
      eq(bibliographicReferences.id, recordAnnotations.referenceId),
    )
    .leftJoin(
      annotationRefObserver,
      eq(annotationRefObserver.id, bibliographicReferences.observerUserId),
    )
    .where(and(...confirmConditions))
    .orderBy(desc(recordAnnotations.id))
    .limit(input.limit + 1);

  const resolveRows = await listResolutions(db, visibility, userId, input, cursorId);

  const merged: MergedAnnotationRow[] = [
    ...confirmRows.map((r) => ({ ...r, kind: 'confirm' as const })),
    ...resolveRows.map((r) => ({
      id: r.id,
      kind: 'resolve' as const,
      note: null,
      generated: false,
      createdAt: r.createdAt,
      recordId: r.recordId,
      referenceId: null,
      citationKey: null,
      referenceKind: null,
      referenceObserverId: null,
      referenceObserverName: null,
      shortCitation: null,
    })),
  ].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  const { page, nextCursor } = pageOf(merged, input.limit, (r) => encodeCursor(r.id));
  if (page.length === 0) return { data: [], nextCursor };

  const recordIds = [
    ...new Set(page.map((r) => r.recordId).filter((id): id is string => id !== null)),
  ];
  const itemById = new Map<string, RecordItem>();
  if (recordIds.length > 0) {
    const items = await itemQuery(db, visibility).where(inArray(traitRecords.id, recordIds));
    for (const i of items) itemById.set(i.record.id, toItem(i));
  }

  const data: ContributionAnnotation[] = page.map((r) => ({
    id: r.id,
    kind: r.kind,
    note: r.note,
    reference:
      r.referenceId && r.citationKey && r.referenceKind
        ? {
            id: r.referenceId,
            citationKey: r.citationKey,
            kind: r.referenceKind,
            observer:
              r.referenceObserverId && r.referenceObserverName
                ? { id: r.referenceObserverId, name: r.referenceObserverName }
                : null,
            shortCitation: r.shortCitation,
          }
        : null,
    generated: r.generated,
    createdAt: r.createdAt.toISOString(),
    record: r.recordId ? (itemById.get(r.recordId) ?? null) : null,
  }));
  return { data, nextCursor };
}

/**
 * One user's contributions, newest first with a keyset cursor on the listed
 * row's id. The viewer's visibility hides records on species or traits they
 * may no longer see, even their own (RFC-33); {@link contributionSummary}
 * counts those all the same, so the numbers stay true.
 * @rfc RFC-71 R1, R2, R3, R5
 * @rfc RFC-33 R2, R3
 */
export async function listContributions(
  db: DbExecutor,
  visibility: Visibility,
  userId: string,
  input: ListContributionsQuery & { limit: number },
): Promise<{ data: ContributionRecord[] | ContributionAnnotation[]; nextCursor: string | null }> {
  return input.kind === 'records'
    ? listRecordContributions(db, visibility, userId, input)
    : listAnnotationContributions(db, visibility, userId, input);
}

/**
 * One user's standing: one count per number, each over an indexed column.
 * Visibility deliberately plays no part (RFC-71 R4). `contests` counts the
 * viewer's contests that are not withdrawn (RFC-63 R14), one per contest,
 * whether or not it created a record — never the viewer's records with
 * `intent = 'contest'`.
 * @rfc RFC-71 R4, R5
 */
export async function contributionSummary(
  db: DbExecutor,
  userId: string,
): Promise<ContributionSummary> {
  const mine = and(
    eq(traitRecords.createdBy, userId),
    eq(traitRecords.origin, 'manual'),
    liveSql(sql`${traitRecords.id}`),
  ) as SQL;
  const records = async (where: SQL): Promise<number> => {
    const [row] = await db.select({ n: count() }).from(traitRecords).where(where);
    return row?.n ?? 0;
  };
  const contestsCount = async (): Promise<number> => {
    const [row] = await db
      .select({ n: count() })
      .from(contests)
      .where(and(eq(contests.createdBy, userId), sql`not ${contestWithdrawnSql('contests')}`));
    return row?.n ?? 0;
  };
  const validationsCount = async (): Promise<number> => {
    const [row] = await db
      .select({ n: count() })
      .from(recordAnnotations)
      .where(
        and(
          eq(recordAnnotations.actorId, userId),
          eq(recordAnnotations.kind, 'confirm'),
          sql`exists (select 1 from ${traitRecords} sv_r where sv_r.id = ${recordAnnotations.recordId} and ${liveSql(sql`sv_r.id`)})`,
        ),
      );
    return row?.n ?? 0;
  };
  const [contributed, contestsN, complements, validations] = await Promise.all([
    records(mine),
    contestsCount(),
    records(and(mine, eq(traitRecords.intent, 'complement')) as SQL),
    validationsCount(),
  ]);
  return {
    records: contributed,
    contests: contestsN,
    complements,
    validations,
  };
}

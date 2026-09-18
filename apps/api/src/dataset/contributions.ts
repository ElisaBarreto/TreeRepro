import type {
  ContributionAnnotation,
  ContributionRecord,
  ContributionSummary,
  ListContributionsQuery,
} from '@treerepro/contracts';
import { and, count, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { acceptedValues, recordAnnotations } from '../db/schema/curation.ts';
import { traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import { decodeCursor, encodeCursor, pageOf } from '../http/cursor.ts';
import { itemQuery, reviewStatusSql, toItem } from './records.ts';

const annotationRefObserver = alias(users, 'annotation_ref_observer');

const DAY_MS = 24 * 60 * 60 * 1000;

/** `from` and `to` are inclusive day bounds in UTC (RFC-71 R1). */
const dayStart = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
const dayAfter = (isoDate: string) => new Date(dayStart(isoDate).getTime() + DAY_MS);

/**
 * Is this record the current accepted value of its species and trait? The
 * newest `accepted_values` row decides, and it is picked with `order by a.id
 * desc limit 1`: PostgreSQL has no `max(uuid)` (`docs/gotchas/dataset.md`).
 * Every column arrives wrapped in its own `sql` fragment so it stays qualified
 * even in a single-table select, where Drizzle rewrites a bare top-level
 * column of an `sql` selection field to an unqualified name — which would bind
 * to the correlated subquery's own `accepted_values` columns instead.
 */
function isAcceptedSql(speciesId: SQL, traitId: SQL, recordId: SQL): SQL<boolean> {
  return sql<boolean>`exists (select 1 from (
    select a.decision, a.record_id from ${acceptedValues} a
    where a.species_id = ${speciesId} and a.trait_id = ${traitId}
    order by a.id desc limit 1) cur
    where cur.decision = 'accepted' and cur.record_id = ${recordId})`;
}

/** Records responding to this one (RFC-70 R1). */
function responseCountSql(recordId: SQL): SQL<number> {
  return sql<number>`(select count(*) from ${traitRecords} x
    where x.responds_to_record_id = ${recordId})::int`;
}

/** Has anybody withdrawn this record (RFC-63 R6)? */
function withdrawnSql(recordId: SQL): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${recordAnnotations} w
    where w.record_id = ${recordId} and w.kind = 'withdraw')`;
}

/**
 * The filters of RFC-71 R1, all of them predicates on the record: for
 * `kind=annotations` they apply to the annotated record (R3).
 */
function recordFilters(input: ListContributionsQuery): SQL[] {
  const conditions: SQL[] = [];
  if (input.traitId) conditions.push(eq(traitRecords.traitId, input.traitId));
  if (input.speciesId) conditions.push(eq(traitRecords.speciesId, input.speciesId));
  if (input.review) {
    conditions.push(sql`${reviewStatusSql(traitRecords.id)} = ${input.review}`);
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
 * `isAccepted` and `responseCount` for one page of records. They are read
 * separately because {@link itemQuery}'s selection is fixed, and keeping it
 * that way is what lets every record item in the API share one join.
 */
async function standings(
  db: DbExecutor,
  ids: string[],
): Promise<Map<string, { isAccepted: boolean; responseCount: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: traitRecords.id,
      isAccepted: isAcceptedSql(
        sql`${traitRecords.speciesId}`,
        sql`${traitRecords.traitId}`,
        sql`${traitRecords.id}`,
      ).as('is_accepted'),
      responseCount: responseCountSql(sql`${traitRecords.id}`).as('response_count'),
    })
    .from(traitRecords)
    .where(inArray(traitRecords.id, ids));
  return new Map(
    rows.map((r) => [r.id, { isAccepted: r.isAccepted, responseCount: r.responseCount }]),
  );
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
    ...recordFilters(input),
  ];
  if (input.cursor) conditions.push(lt(traitRecords.id, decodeCursor(input.cursor)));
  const rows = await itemQuery(db)
    .where(and(...conditions))
    .orderBy(desc(traitRecords.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.record.id));
  const standing = await standings(
    db,
    page.map((r) => r.record.id),
  );
  const data = page.map((r) => ({
    ...toItem(r),
    isAccepted: standing.get(r.record.id)?.isAccepted ?? false,
    responseCount: standing.get(r.record.id)?.responseCount ?? 0,
  }));
  return { data, nextCursor };
}

/** @rfc RFC-71 R3 */
async function listAnnotationContributions(
  db: DbExecutor,
  visibility: Visibility,
  userId: string,
  input: ListContributionsQuery & { limit: number },
): Promise<{ data: ContributionAnnotation[]; nextCursor: string | null }> {
  const conditions: SQL[] = [
    eq(recordAnnotations.actorId, userId),
    speciesVisible(visibility),
    traitVisible(visibility),
    ...recordFilters(input),
  ];
  if (input.cursor) conditions.push(lt(recordAnnotations.id, decodeCursor(input.cursor)));
  const rows = await db
    .select({
      id: recordAnnotations.id,
      recordId: recordAnnotations.recordId,
      kind: recordAnnotations.kind,
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
    .where(and(...conditions))
    .orderBy(desc(recordAnnotations.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.id));
  if (page.length === 0) return { data: [], nextCursor };
  // The record items come through the shared join, as the disputed queue does.
  const items = await itemQuery(db).where(
    inArray(
      traitRecords.id,
      page.map((r) => r.recordId),
    ),
  );
  const itemById = new Map(items.map((i) => [i.record.id, toItem(i)]));
  const data = page.flatMap((r) => {
    const record = itemById.get(r.recordId);
    if (!record) return [];
    return [
      {
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
        record,
      },
    ];
  });
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
 * Visibility deliberately plays no part (RFC-71 R4).
 * @rfc RFC-71 R4, R5
 */
export async function contributionSummary(
  db: DbExecutor,
  userId: string,
): Promise<ContributionSummary> {
  const mine = and(eq(traitRecords.createdBy, userId), eq(traitRecords.origin, 'manual')) as SQL;
  const records = async (where: SQL): Promise<number> => {
    const [row] = await db.select({ n: count() }).from(traitRecords).where(where);
    return row?.n ?? 0;
  };
  const annotations = async (kind: 'confirm' | 'dispute'): Promise<number> => {
    const [row] = await db
      .select({ n: count() })
      .from(recordAnnotations)
      .where(and(eq(recordAnnotations.actorId, userId), eq(recordAnnotations.kind, kind)));
    return row?.n ?? 0;
  };
  const [contributed, contests, complements, validations, disputes, withdrawn, accepted] =
    await Promise.all([
      records(mine),
      records(and(mine, eq(traitRecords.intent, 'contest')) as SQL),
      records(and(mine, eq(traitRecords.intent, 'complement')) as SQL),
      annotations('confirm'),
      annotations('dispute'),
      records(and(mine, withdrawnSql(sql`${traitRecords.id}`)) as SQL),
      records(
        and(
          mine,
          isAcceptedSql(
            sql`${traitRecords.speciesId}`,
            sql`${traitRecords.traitId}`,
            sql`${traitRecords.id}`,
          ),
        ) as SQL,
      ),
    ]);
  return {
    records: contributed,
    contests,
    complements,
    validations,
    disputes,
    withdrawn,
    accepted,
  };
}

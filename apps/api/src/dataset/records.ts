import type {
  QuantitativeValue,
  RecordDetail,
  RecordItem,
  ReferenceKind,
  ReviewStatus,
} from '@treerepro/contracts';
import { and, desc, eq, lt, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { importBatches } from '../db/schema/imports.ts';
import { recordReferences, traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import { decodeCursor, encodeCursor, pageOf } from '../http/cursor.ts';

const primaryRef = alias(bibliographicReferences, 'primary_ref');
const secondaryRef = alias(bibliographicReferences, 'secondary_ref');
const author = alias(users, 'author');
const primaryRefObserver = alias(users, 'primary_ref_observer');
const secondaryRefObserver = alias(users, 'secondary_ref_observer');
const annotationRefObserver = alias(users, 'annotation_ref_observer');

type ExtraReference = {
  id: string;
  citationKey: string;
  kind: ReferenceKind;
  shortCitation: string | null;
};

/**
 * A record's `record_references`, ordered by citation key, as one JSON array
 * per row. They are never personal observations — `resolveSources` gives a
 * personal observation alone and refuses one named by id (RFC-61 R7) — so
 * `observer` is always null and no encrypted name is read here.
 */
const extraReferencesSql = sql<ExtraReference[]>`(select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'citationKey', b.citation_key, 'kind', b.kind, 'shortCitation', b.short_citation)
    order by b.citation_key), '[]'::jsonb)
  from ${recordReferences} rr join ${bibliographicReferences} b on b.id = rr.reference_id
  where rr.record_id = ${traitRecords.id})`;

/**
 * The single/min/max/mean/sd/n fields of a record as one object (spec R-5),
 * or null when none is set — a purely categorical or level-based record.
 */
function quantitativeOf(rec: typeof traitRecords.$inferSelect): QuantitativeValue | null {
  const fields = {
    single: rec.numericValue,
    min: rec.minValue,
    max: rec.maxValue,
    mean: rec.meanValue,
    sd: rec.sdValue,
    n: rec.n,
  };
  const given = Object.entries(fields).filter(([, v]) => v !== null);
  return given.length > 0 ? (Object.fromEntries(given) as QuantitativeValue) : null;
}

/**
 * The review axis of one record, derived from its annotations: withdrawn >
 * disputed > confirmed > unreviewed, where a scientist's stance is their
 * latest non-withdraw annotation. `recordId` is wrapped as an `sql` fragment
 * before use: Drizzle's single-table `buildSelection` rewrites a bare top-level
 * `Column` argument (`traitRecords.id`) to an unqualified identifier, which
 * would then resolve inside this function's own correlated subquery over
 * `record_annotations` to that table's own `id` instead of the record being
 * checked — handled here so every caller can pass a bare column.
 * @rfc RFC-63 R6
 */
export function reviewStatusSql(recordId: SQL | typeof traitRecords.id): SQL<ReviewStatus> {
  const id = sql`${recordId}`;
  const stances = sql`(select distinct on (a.actor_id) a.kind from ${recordAnnotations} a
    where a.record_id = ${id} and a.kind <> 'withdraw' order by a.actor_id, a.id desc)`;
  return sql<ReviewStatus>`case
    when exists (select 1 from ${recordAnnotations} w where w.record_id = ${id} and w.kind = 'withdraw') then 'withdrawn'
    when exists (select 1 from ${stances} s where s.kind = 'dispute') then 'disputed'
    when exists (select 1 from ${stances} s where s.kind = 'confirm') then 'confirmed'
    else 'unreviewed' end`;
}

/**
 * No `withdraw` annotation exists for the record (spec R-13): the one
 * definition of "still in the dataset". `recordId` is wrapped for the reason
 * given on {@link reviewStatusSql}.
 * @rfc RFC-63 R6
 */
export function liveSql(recordId: SQL | typeof traitRecords.id): SQL {
  return sql`not exists (select 1 from ${recordAnnotations} lw
    where lw.record_id = ${sql`${recordId}`} and lw.kind = 'withdraw')`;
}

/** Harmonised, unless the viewer reviews (spec R-14). @rfc RFC-33 R2 */
export function harmonisedFor(
  v: Visibility,
  harmonisation: SQL | typeof traitRecords.harmonisation = traitRecords.harmonisation,
): SQL {
  return v.review ? sql`true` : sql`${harmonisation} = 'harmonised'`;
}

/**
 * The level condition of RFC-33 R2: no level, an active level, or a viewer who
 * holds `dataset.read_inactive`. Resolved through an `exists` on
 * `trait_records`/`trait_levels` rather than a join, so a caller need only
 * pass the record's id — the shape both a Drizzle query (`traitRecords.id`,
 * no join needed) and a raw `sql` alias (`r.id`) already have on hand.
 * @rfc RFC-33 R2
 */
function levelVisibleForRecord(v: Visibility, recordId: SQL | typeof traitRecords.id): SQL {
  if (v.inactive) return sql`true`;
  const id = sql`${recordId}`;
  return sql`not exists (select 1 from ${traitRecords} lvr
    join ${traitLevels} lvl on lvl.id = lvr.level_id
    where lvr.id = ${id} and not lvl.active)`;
}

/**
 * A record the viewer reads: live, harmonised or reviewed (RFC-33 R2), and on
 * a level that is null, active, or visible to a `dataset.read_inactive`
 * holder (RFC-33 R2).
 * @rfc RFC-33 R2
 */
export function recordVisible(
  v: Visibility,
  recordId: SQL | typeof traitRecords.id = traitRecords.id,
  harmonisation: SQL | typeof traitRecords.harmonisation = traitRecords.harmonisation,
): SQL {
  return sql`${liveSql(recordId)} and ${harmonisedFor(v, harmonisation)} and ${levelVisibleForRecord(v, recordId)}`;
}

const itemColumns = {
  record: traitRecords,
  speciesName: species.canonicalName,
  traitKey: traits.key,
  traitValueType: traits.valueType,
  traitUnit: traits.unit,
  levelKey: traitLevels.key,
  primaryKey: primaryRef.citationKey,
  primaryKind: primaryRef.kind,
  primaryShortCitation: primaryRef.shortCitation,
  primaryObserverId: primaryRefObserver.id,
  primaryObserverName: primaryRefObserver.name,
  secondaryKey: secondaryRef.citationKey,
  secondaryKind: secondaryRef.kind,
  secondaryShortCitation: secondaryRef.shortCitation,
  secondaryObserverId: secondaryRefObserver.id,
  secondaryObserverName: secondaryRefObserver.name,
  authorName: author.name,
  extraReferences: extraReferencesSql,
};

export type ItemRow = {
  record: typeof traitRecords.$inferSelect;
  speciesName: string;
  traitKey: string;
  traitValueType: RecordItem['trait']['valueType'];
  traitUnit: string | null;
  levelKey: string | null;
  primaryKey: string | null;
  primaryKind: (typeof bibliographicReferences.$inferSelect)['kind'] | null;
  primaryShortCitation: string | null;
  primaryObserverId: string | null;
  primaryObserverName: string | null;
  secondaryKey: string | null;
  secondaryKind: (typeof bibliographicReferences.$inferSelect)['kind'] | null;
  secondaryShortCitation: string | null;
  secondaryObserverId: string | null;
  secondaryObserverName: string | null;
  authorName: string | null;
  extraReferences: ExtraReference[];
  review: ReviewStatus;
};

/** @rfc RFC-63 R8 */
export function toItem(r: ItemRow): RecordItem {
  const rec = r.record;
  const primaryReference =
    rec.primaryReferenceId && r.primaryKey && r.primaryKind
      ? {
          id: rec.primaryReferenceId,
          citationKey: r.primaryKey,
          kind: r.primaryKind,
          observer:
            r.primaryObserverId && r.primaryObserverName
              ? { id: r.primaryObserverId, name: r.primaryObserverName }
              : null,
          shortCitation: r.primaryShortCitation,
        }
      : null;
  const secondaryReference =
    rec.secondaryReferenceId && r.secondaryKey && r.secondaryKind
      ? {
          id: rec.secondaryReferenceId,
          citationKey: r.secondaryKey,
          kind: r.secondaryKind,
          observer:
            r.secondaryObserverId && r.secondaryObserverName
              ? { id: r.secondaryObserverId, name: r.secondaryObserverName }
              : null,
          shortCitation: r.secondaryShortCitation,
        }
      : null;
  // The item's `references` (spec R-4, owner amendment 4): the primary
  // reference first, then the legacy secondary one when present, then the
  // `record_references` rows (already ordered by citation key). A reference
  // named twice — e.g. the secondary one repeated in `record_references` —
  // is kept once, in its earliest slot.
  const seenReferenceIds = new Set<string>();
  const references = [
    primaryReference,
    secondaryReference,
    ...r.extraReferences.map((x) => ({ ...x, observer: null })),
  ].filter((ref): ref is NonNullable<typeof ref> => {
    if (!ref || seenReferenceIds.has(ref.id)) return false;
    seenReferenceIds.add(ref.id);
    return true;
  });
  return {
    id: rec.id,
    recordCode: rec.recordCode,
    speciesId: rec.speciesId,
    species: { id: rec.speciesId, canonicalName: r.speciesName },
    trait: { id: rec.traitId, key: r.traitKey, valueType: r.traitValueType, unit: r.traitUnit },
    valueText: rec.valueText,
    level: rec.levelId && r.levelKey ? { id: rec.levelId, key: r.levelKey } : null,
    numericValue: rec.numericValue,
    quantitative: quantitativeOf(rec),
    harmonisation: rec.harmonisation,
    review: r.review,
    primaryReference,
    secondaryReference,
    references,
    origin: rec.origin,
    createdAt: rec.createdAt.toISOString(),
    createdBy: rec.createdBy && r.authorName ? { id: rec.createdBy, name: r.authorName } : null,
    intent: rec.intent ?? null,
    respondsTo: rec.respondsToRecordId ? { id: rec.respondsToRecordId } : null,
  };
}

/** The joined select behind every record item; the queues reuse it. @rfc RFC-63 R8 */
export function itemQuery(db: DbExecutor) {
  return db
    .select({ ...itemColumns, review: reviewStatusSql(traitRecords.id).as('review') })
    .from(traitRecords)
    .innerJoin(species, eq(species.id, traitRecords.speciesId))
    .innerJoin(traits, eq(traits.id, traitRecords.traitId))
    .leftJoin(traitLevels, eq(traitLevels.id, traitRecords.levelId))
    .leftJoin(primaryRef, eq(primaryRef.id, traitRecords.primaryReferenceId))
    .leftJoin(secondaryRef, eq(secondaryRef.id, traitRecords.secondaryReferenceId))
    .leftJoin(primaryRefObserver, eq(primaryRefObserver.id, primaryRef.observerUserId))
    .leftJoin(secondaryRefObserver, eq(secondaryRefObserver.id, secondaryRef.observerUserId))
    .leftJoin(author, eq(author.id, traitRecords.createdBy));
}

/**
 * Either `speciesId` and `traitId` together, or `referenceId` alone (primary,
 * secondary or `record_references`); ordered `id` descending with a keyset
 * cursor.
 * @rfc RFC-63 R9
 * @rfc RFC-33 R2, R3
 */
export async function listRecords(
  db: DbExecutor,
  visibility: Visibility,
  input: {
    speciesId?: string;
    traitId?: string;
    referenceId?: string;
    cursor?: string;
    limit: number;
  },
): Promise<{ data: RecordItem[]; nextCursor: string | null }> {
  const conditions: SQL[] = [
    speciesVisible(visibility),
    traitVisible(visibility),
    recordVisible(visibility),
  ];
  if (input.speciesId && input.traitId) {
    conditions.push(
      eq(traitRecords.speciesId, input.speciesId),
      eq(traitRecords.traitId, input.traitId),
    );
  } else if (input.referenceId) {
    conditions.push(
      sql`${traitRecords.id} in (
        select r.id from ${traitRecords} r
        where r.primary_reference_id = ${input.referenceId} or r.secondary_reference_id = ${input.referenceId}
        union all
        select rr.record_id from ${recordReferences} rr where rr.reference_id = ${input.referenceId})`,
    );
  } else {
    throw new Error('listRecords: speciesId+traitId or referenceId is required');
  }
  if (input.cursor) conditions.push(lt(traitRecords.id, decodeCursor(input.cursor)));
  const rows = await itemQuery(db)
    .where(and(...conditions))
    .orderBy(desc(traitRecords.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.record.id));
  return { data: page.map(toItem), nextCursor };
}

/**
 * The record detail: raw fields, its import batch (when imported), and its
 * annotations.
 * @rfc RFC-63 R8
 * @rfc RFC-33 R2, R4
 */
export async function getRecord(
  db: DbExecutor,
  visibility: Visibility,
  id: string,
): Promise<RecordDetail | null> {
  const [row] = await itemQuery(db)
    .where(
      and(
        eq(traitRecords.id, id),
        speciesVisible(visibility),
        traitVisible(visibility),
        recordVisible(visibility),
      ),
    )
    .limit(1);
  if (!row) return null;
  const rec = row.record;
  const [batch, annotations, supersededBy, responses] = await Promise.all([
    rec.importBatchId
      ? db
          .select({
            id: importBatches.id,
            fileName: importBatches.fileName,
            startedAt: importBatches.startedAt,
          })
          .from(importBatches)
          .where(eq(importBatches.id, rec.importBatchId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: recordAnnotations.id,
        kind: recordAnnotations.kind,
        note: recordAnnotations.note,
        generated: recordAnnotations.generated,
        refId: bibliographicReferences.id,
        refCitationKey: bibliographicReferences.citationKey,
        refKind: bibliographicReferences.kind,
        refShortCitation: bibliographicReferences.shortCitation,
        refObserverId: annotationRefObserver.id,
        refObserverName: annotationRefObserver.name,
        actorId: users.id,
        actorName: users.name,
        createdAt: recordAnnotations.createdAt,
      })
      .from(recordAnnotations)
      .innerJoin(users, eq(users.id, recordAnnotations.actorId))
      .leftJoin(
        bibliographicReferences,
        eq(bibliographicReferences.id, recordAnnotations.referenceId),
      )
      .leftJoin(
        annotationRefObserver,
        eq(annotationRefObserver.id, bibliographicReferences.observerUserId),
      )
      .where(eq(recordAnnotations.recordId, id))
      .orderBy(desc(recordAnnotations.id)),
    db
      .select({ id: traitRecords.id })
      .from(traitRecords)
      .where(eq(traitRecords.supersedesRecordId, id))
      .orderBy(desc(traitRecords.id)),
    db
      .select({
        id: traitRecords.id,
        intent: traitRecords.intent,
        creatorId: users.id,
        creatorName: users.name,
        createdAt: traitRecords.createdAt,
      })
      .from(traitRecords)
      .leftJoin(users, eq(users.id, traitRecords.createdBy))
      .where(eq(traitRecords.respondsToRecordId, id))
      .orderBy(desc(traitRecords.id)),
  ]);
  const b = batch[0];
  return {
    ...toItem(row),
    rawValue: rec.rawValue,
    originalTraitName: rec.originalTraitName,
    originalSpeciesName: rec.originalSpeciesName,
    secondarySourceSpeciesName: rec.secondarySourceSpeciesName,
    rawCategory: rec.rawCategory,
    note: rec.note,
    importBatch: b
      ? { id: b.id, fileName: b.fileName, startedAt: b.startedAt.toISOString() }
      : null,
    importRowNo: rec.importRowNo,
    annotations: annotations.map((a) => ({
      id: a.id,
      kind: a.kind,
      note: a.note,
      actor: { id: a.actorId, name: a.actorName },
      reference:
        a.refId && a.refCitationKey && a.refKind
          ? {
              id: a.refId,
              citationKey: a.refCitationKey,
              kind: a.refKind,
              observer:
                a.refObserverId && a.refObserverName
                  ? { id: a.refObserverId, name: a.refObserverName }
                  : null,
              shortCitation: a.refShortCitation,
            }
          : null,
      generated: a.generated,
      createdAt: a.createdAt.toISOString(),
    })),
    supersedes: rec.supersedesRecordId ? { id: rec.supersedesRecordId } : null,
    supersededBy: supersededBy.map((r) => ({ id: r.id })),
    // `trait_records_intent_check` keeps `intent` and `responds_to_record_id`
    // together, so a row selected by `responds_to_record_id` always has one;
    // the guard is what tells the compiler, not a runtime expectation.
    responses: responses.flatMap((res) =>
      res.intent === null
        ? []
        : [
            {
              id: res.id,
              intent: res.intent,
              createdBy:
                res.creatorId && res.creatorName
                  ? { id: res.creatorId, name: res.creatorName }
                  : null,
              createdAt: res.createdAt.toISOString(),
            },
          ],
    ),
  };
}

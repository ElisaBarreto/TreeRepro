import type { RecordDetail, RecordItem, ReviewStatus } from '@treerepro/contracts';
import { and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { acceptedValues, recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { importBatches } from '../db/schema/imports.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import { decodeCursor, encodeCursor, pageOf } from '../http/cursor.ts';

const primaryRef = alias(bibliographicReferences, 'primary_ref');
const secondaryRef = alias(bibliographicReferences, 'secondary_ref');
const author = alias(users, 'author');

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

const itemColumns = {
  record: traitRecords,
  speciesName: species.canonicalName,
  traitKey: traits.key,
  traitValueType: traits.valueType,
  traitUnit: traits.unit,
  levelKey: traitLevels.key,
  primaryKey: primaryRef.citationKey,
  primaryKind: primaryRef.kind,
  secondaryKey: secondaryRef.citationKey,
  secondaryKind: secondaryRef.kind,
  authorName: author.name,
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
  secondaryKey: string | null;
  secondaryKind: (typeof bibliographicReferences.$inferSelect)['kind'] | null;
  authorName: string | null;
  review: ReviewStatus;
};

/** @rfc RFC-63 R8 */
export function toItem(r: ItemRow): RecordItem {
  const rec = r.record;
  return {
    id: rec.id,
    speciesId: rec.speciesId,
    species: { id: rec.speciesId, canonicalName: r.speciesName },
    trait: { id: rec.traitId, key: r.traitKey, valueType: r.traitValueType, unit: r.traitUnit },
    valueText: rec.valueText,
    level: rec.levelId && r.levelKey ? { id: rec.levelId, key: r.levelKey } : null,
    numericValue: rec.numericValue,
    harmonisation: rec.harmonisation,
    review: r.review,
    // `shortCitation` is null here until plan 10d's column lands; the item
    // query does not select it.
    primaryReference:
      rec.primaryReferenceId && r.primaryKey && r.primaryKind
        ? {
            id: rec.primaryReferenceId,
            citationKey: r.primaryKey,
            kind: r.primaryKind,
            shortCitation: null,
          }
        : null,
    secondaryReference:
      rec.secondaryReferenceId && r.secondaryKey && r.secondaryKind
        ? {
            id: rec.secondaryReferenceId,
            citationKey: r.secondaryKey,
            kind: r.secondaryKind,
            shortCitation: null,
          }
        : null,
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
    .leftJoin(author, eq(author.id, traitRecords.createdBy));
}

/**
 * Either `speciesId` and `traitId` together, or `referenceId` alone (primary
 * or secondary); ordered `id` descending with a keyset cursor.
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
  const conditions: SQL[] = [speciesVisible(visibility), traitVisible(visibility)];
  if (input.speciesId && input.traitId) {
    conditions.push(
      eq(traitRecords.speciesId, input.speciesId),
      eq(traitRecords.traitId, input.traitId),
    );
  } else if (input.referenceId) {
    conditions.push(
      or(
        eq(traitRecords.primaryReferenceId, input.referenceId),
        eq(traitRecords.secondaryReferenceId, input.referenceId),
      ) as SQL,
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
 * The record detail: raw fields, its import batch (when imported), its
 * annotations and the accepted-value history of its species and trait.
 * @rfc RFC-63 R8
 * @rfc RFC-33 R2, R4
 */
export async function getRecord(
  db: DbExecutor,
  visibility: Visibility,
  id: string,
): Promise<RecordDetail | null> {
  const [row] = await itemQuery(db)
    .where(and(eq(traitRecords.id, id), speciesVisible(visibility), traitVisible(visibility)))
    .limit(1);
  if (!row) return null;
  const rec = row.record;
  const [batch, annotations, history, supersededBy, responses] = await Promise.all([
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
      .where(eq(recordAnnotations.recordId, id))
      .orderBy(desc(recordAnnotations.id)),
    db
      .select({
        id: acceptedValues.id,
        decision: acceptedValues.decision,
        recordId: acceptedValues.recordId,
        note: acceptedValues.note,
        actorId: users.id,
        actorName: users.name,
        createdAt: acceptedValues.createdAt,
      })
      .from(acceptedValues)
      .innerJoin(users, eq(users.id, acceptedValues.actorId))
      .where(
        and(eq(acceptedValues.speciesId, rec.speciesId), eq(acceptedValues.traitId, rec.traitId)),
      )
      .orderBy(desc(acceptedValues.id)),
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
          ? { id: a.refId, citationKey: a.refCitationKey, kind: a.refKind, shortCitation: null }
          : null,
      generated: a.generated,
      createdAt: a.createdAt.toISOString(),
    })),
    acceptedHistory: history.map((h) => ({
      id: h.id,
      decision: h.decision,
      recordId: h.recordId,
      actor: { id: h.actorId, name: h.actorName },
      note: h.note,
      createdAt: h.createdAt.toISOString(),
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

import type { RecordDetail, RecordItem, ReviewStatus } from '@treerepro/contracts';
import { and, desc, eq, lt, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '../db/client.ts';
import { acceptedValues, recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { importBatches } from '../db/schema/imports.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { users } from '../db/schema/users.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';

const primaryRef = alias(bibliographicReferences, 'primary_ref');
const secondaryRef = alias(bibliographicReferences, 'secondary_ref');
const author = alias(users, 'author');

/**
 * The review axis of one record, derived from its annotations: withdrawn >
 * disputed > confirmed > unreviewed, where a scientist's stance is their
 * latest non-withdraw annotation.
 * @rfc RFC-63 R6
 */
export function reviewStatusSql(recordId: SQL | typeof traitRecords.id): SQL<ReviewStatus> {
  const stances = sql`(select distinct on (a.actor_id) a.kind from ${recordAnnotations} a
    where a.record_id = ${recordId} and a.kind <> 'withdraw' order by a.actor_id, a.id desc)`;
  return sql<ReviewStatus>`case
    when exists (select 1 from ${recordAnnotations} w where w.record_id = ${recordId} and w.kind = 'withdraw') then 'withdrawn'
    when exists (select 1 from ${stances} s where s.kind = 'dispute') then 'disputed'
    when exists (select 1 from ${stances} s where s.kind = 'confirm') then 'confirmed'
    else 'unreviewed' end`;
}

const itemColumns = {
  record: traitRecords,
  traitKey: traits.key,
  traitValueType: traits.valueType,
  traitUnit: traits.unit,
  levelKey: traitLevels.key,
  primaryKey: primaryRef.citationKey,
  secondaryKey: secondaryRef.citationKey,
  authorName: author.name,
};

type ItemRow = {
  record: typeof traitRecords.$inferSelect;
  traitKey: string;
  traitValueType: RecordItem['trait']['valueType'];
  traitUnit: string | null;
  levelKey: string | null;
  primaryKey: string | null;
  secondaryKey: string | null;
  authorName: string | null;
  review: ReviewStatus;
};

function toItem(r: ItemRow): RecordItem {
  const rec = r.record;
  return {
    id: rec.id,
    speciesId: rec.speciesId,
    trait: { id: rec.traitId, key: r.traitKey, valueType: r.traitValueType, unit: r.traitUnit },
    valueText: rec.valueText,
    level: rec.levelId && r.levelKey ? { id: rec.levelId, key: r.levelKey } : null,
    numericValue: rec.numericValue,
    harmonisation: rec.harmonisation,
    review: r.review,
    primaryReference:
      rec.primaryReferenceId && r.primaryKey
        ? { id: rec.primaryReferenceId, citationKey: r.primaryKey }
        : null,
    secondaryReference:
      rec.secondaryReferenceId && r.secondaryKey
        ? { id: rec.secondaryReferenceId, citationKey: r.secondaryKey }
        : null,
    origin: rec.origin,
    createdAt: rec.createdAt.toISOString(),
    createdBy: rec.createdBy && r.authorName ? { id: rec.createdBy, name: r.authorName } : null,
  };
}

function itemQuery(db: DbExecutor) {
  return db
    .select({ ...itemColumns, review: reviewStatusSql(traitRecords.id).as('review') })
    .from(traitRecords)
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
 */
export async function listRecords(
  db: DbExecutor,
  input: {
    speciesId?: string;
    traitId?: string;
    referenceId?: string;
    cursor?: string;
    limit: number;
  },
): Promise<{ data: RecordItem[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
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
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(toItem),
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.record.id) : null,
  };
}

/**
 * The record detail: raw fields, its import batch (when imported), its
 * annotations and the accepted-value history of its species and trait.
 * @rfc RFC-63 R8
 */
export async function getRecord(db: DbExecutor, id: string): Promise<RecordDetail | null> {
  const [row] = await itemQuery(db).where(eq(traitRecords.id, id)).limit(1);
  if (!row) return null;
  const rec = row.record;
  const [batch, annotations, history] = await Promise.all([
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
        actorId: users.id,
        actorName: users.name,
        createdAt: recordAnnotations.createdAt,
      })
      .from(recordAnnotations)
      .innerJoin(users, eq(users.id, recordAnnotations.actorId))
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
  };
}

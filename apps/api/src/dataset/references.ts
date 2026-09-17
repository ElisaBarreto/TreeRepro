import type { Reference, ReferenceDetail } from '@treerepro/contracts';
import { and, count, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences, type ReferenceRow } from '../db/schema/references.ts';
import { users } from '../db/schema/users.ts';
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isDigits,
  isUuid,
  pageOf,
} from '../http/cursor.ts';
import type { DoiMetadata } from '../integrations/doi.ts';
import { likePattern } from './taxa.ts';

/** @rfc RFC-61 R4 */
export function toReference(
  row: ReferenceRow,
  observer?: { id: string; name: string } | null,
): Reference {
  return {
    id: row.id,
    citationKey: row.citationKey,
    title: row.title,
    authors: row.authors,
    year: row.year,
    journal: row.journal,
    doi: row.doi,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
    primaryCount: row.primaryCount,
    secondaryCount: row.secondaryCount,
    kind: row.kind,
    observer: observer?.id ? { id: observer.id, name: observer.name } : null,
  };
}

// A usage total in a cursor: digits that still fit a JS integer, so the bigint
// cast below never sees `Infinity`.
const isUsageCount = (part: string) => isDigits(part) && Number.isSafeInteger(Number(part));

/**
 * Most used first (`usage_count` = `primaryCount + secondaryCount` desc, then
 * id desc); composite cursor `[total, id]`. The counters are stored on the row
 * and maintained by the `trait_records` insert trigger (schema/references.ts),
 * so a page is one index-ordered scan of `bibliographic_references_usage_idx`
 * whatever the size of `trait_records`.
 * @rfc RFC-61 R4
 */
export async function searchReferences(
  db: DbExecutor,
  input: { q?: string; cursor?: string; limit: number; kind?: 'publication' | 'all' },
): Promise<{ data: Reference[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (input.kind !== 'all') {
    conditions.push(eq(bibliographicReferences.kind, 'publication'));
  }
  if (input.q) {
    const pattern = likePattern(input.q, 'substring');
    conditions.push(
      or(
        ilike(bibliographicReferences.citationKey, pattern),
        ilike(bibliographicReferences.title, pattern),
      ) as SQL,
    );
  }
  if (input.cursor) {
    const [total, id] = decodeCompositeCursor(input.cursor, 2, [isUsageCount, isUuid]) as [
      string,
      string,
    ];
    conditions.push(
      sql`(${bibliographicReferences.usageCount}, ${bibliographicReferences.id}) < (${Number(total)}::int, ${id}::uuid)`,
    );
  }
  const rows = await db
    .select({
      ref: bibliographicReferences,
      observer: { id: users.id, name: users.name },
    })
    .from(bibliographicReferences)
    .leftJoin(users, eq(users.id, bibliographicReferences.observerUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bibliographicReferences.usageCount), desc(bibliographicReferences.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([String(r.ref.usageCount), r.ref.id]),
  );
  return {
    data: page.map((r) => toReference(r.ref, r.observer?.id ? r.observer : null)),
    nextCursor,
  };
}

/** @rfc RFC-61 R4 */
export async function getReference(db: DbExecutor, id: string): Promise<ReferenceDetail | null> {
  const [row] = await db
    .select({
      ref: bibliographicReferences,
      observer: { id: users.id, name: users.name },
    })
    .from(bibliographicReferences)
    .leftJoin(users, eq(users.id, bibliographicReferences.observerUserId))
    .where(eq(bibliographicReferences.id, id))
    .limit(1);
  if (!row) return null;
  const [counts] = await db
    .select({ recordCount: count() })
    .from(traitRecords)
    .where(or(eq(traitRecords.primaryReferenceId, id), eq(traitRecords.secondaryReferenceId, id)));
  return {
    ...toReference(row.ref, row.observer?.id ? row.observer : null),
    recordCount: counts?.recordCount ?? 0,
  };
}

/** @rfc RFC-61 R7 */
export async function ensurePersonalObservation(
  db: DbExecutor,
  userId: string,
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: bibliographicReferences.id })
    .from(bibliographicReferences)
    .where(
      and(
        eq(bibliographicReferences.kind, 'personal_observation'),
        eq(bibliographicReferences.observerUserId, userId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  try {
    const [inserted] = await db
      .insert(bibliographicReferences)
      .values({
        citationKey: `personal-observation:${userId}`,
        kind: 'personal_observation',
        observerUserId: userId,
        createdBy: userId,
      })
      .returning({ id: bibliographicReferences.id });
    if (!inserted) throw new Error('ensurePersonalObservation: insert returned no row');
    await recordAudit(db, {
      actorUserId: userId,
      action: 'references.created',
      targetType: 'bibliographic_references',
      targetId: inserted.id,
      metadata: { kind: 'personal_observation' },
    });
    return inserted;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [reRead] = await db
        .select({ id: bibliographicReferences.id })
        .from(bibliographicReferences)
        .where(
          and(
            eq(bibliographicReferences.kind, 'personal_observation'),
            eq(bibliographicReferences.observerUserId, userId),
          ),
        )
        .limit(1);
      if (reRead) return reRead;
    }
    throw err;
  }
}

/** @rfc RFC-80 R1, R5 */
export async function findReferenceByDoi(db: DbExecutor, doi: string): Promise<Reference | null> {
  const normalised = doi.trim().toLowerCase();
  const [row] = await db
    .select({
      ref: bibliographicReferences,
      observer: { id: users.id, name: users.name },
    })
    .from(bibliographicReferences)
    .leftJoin(users, eq(users.id, bibliographicReferences.observerUserId))
    .where(sql`lower(${bibliographicReferences.doi}) = ${normalised}`)
    .limit(1);
  if (!row) return null;
  return toReference(row.ref, row.observer?.id ? row.observer : null);
}

/** @rfc RFC-61 R8 */
export async function createReferenceFromDoi(
  db: DbExecutor,
  input: { doi: string; metadata: DoiMetadata | null; actorId: string },
): Promise<Reference> {
  const norm = input.doi.trim().toLowerCase();
  const existing = await findReferenceByDoi(db, norm);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    try {
      const [inserted] = await tx
        .insert(bibliographicReferences)
        .values({
          citationKey: `doi:${norm}`,
          title: input.metadata?.title ?? null,
          authors: input.metadata?.authors ?? null,
          year: input.metadata?.year ?? null,
          journal: input.metadata?.journal ?? null,
          doi: norm,
          url: `https://doi.org/${norm}`,
          createdBy: input.actorId,
          kind: 'publication',
        })
        .returning({ id: bibliographicReferences.id });
      if (inserted) {
        await recordAudit(tx, {
          actorUserId: input.actorId,
          action: 'references.created',
          targetType: 'bibliographic_references',
          targetId: inserted.id,
          metadata: { source: 'doi' },
        });
      }
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    const found = await findReferenceByDoi(tx, norm);
    if (!found) throw new Error('createReferenceFromDoi: reference not found after insert');
    return found;
  });
}


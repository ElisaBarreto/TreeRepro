import type { Reference, ReferenceDetail } from '@treerepro/contracts';
import { and, count, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences, type ReferenceRow } from '../db/schema/references.ts';
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isDigits,
  isUuid,
  pageOf,
} from '../http/cursor.ts';
import { likePattern } from './taxa.ts';

/** @rfc RFC-61 R4 */
export function toReference(row: ReferenceRow): Reference {
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
  input: { q?: string; cursor?: string; limit: number },
): Promise<{ data: Reference[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
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
    .select()
    .from(bibliographicReferences)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // The sort key (usage count) is mutable: pages stay stable between
    // writes, but a concurrent import or manual record can shift a reference
    // between two page fetches (acceptable — a reference that gained a use
    // moves up, nothing is lost from the pages still to come).
    .orderBy(desc(bibliographicReferences.usageCount), desc(bibliographicReferences.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([String(r.usageCount), r.id]),
  );
  return { data: page.map(toReference), nextCursor };
}

/** @rfc RFC-61 R4 */
export async function getReference(db: DbExecutor, id: string): Promise<ReferenceDetail | null> {
  const [row] = await db
    .select()
    .from(bibliographicReferences)
    .where(eq(bibliographicReferences.id, id))
    .limit(1);
  if (!row) return null;
  // Records naming it in either role, counted once even when both roles name
  // it — the one figure the stored counters cannot give (one indexed lookup
  // per role, a single reference).
  const [counts] = await db
    .select({ recordCount: count() })
    .from(traitRecords)
    .where(or(eq(traitRecords.primaryReferenceId, id), eq(traitRecords.secondaryReferenceId, id)));
  return { ...toReference(row), recordCount: counts?.recordCount ?? 0 };
}

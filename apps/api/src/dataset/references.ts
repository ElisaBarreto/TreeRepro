import type { Reference, ReferenceDetail } from '@treerepro/contracts';
import { and, asc, count, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences, type ReferenceRow } from '../db/schema/references.ts';
import { decodeCompositeCursor, encodeCompositeCursor, isUuid } from '../http/cursor.ts';
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
  };
}

/** @rfc RFC-61 R4 */
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
    const [key, id] = decodeCompositeCursor(input.cursor, 2, [() => true, isUuid]) as [
      string,
      string,
    ];
    conditions.push(
      sql`(${bibliographicReferences.citationKey}, ${bibliographicReferences.id}) > (${key}, ${id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(bibliographicReferences)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(bibliographicReferences.citationKey), asc(bibliographicReferences.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(toReference),
    nextCursor:
      rows.length > input.limit && last ? encodeCompositeCursor([last.citationKey, last.id]) : null,
  };
}

/** @rfc RFC-61 R4 */
export async function getReference(db: DbExecutor, id: string): Promise<ReferenceDetail | null> {
  const [row] = await db
    .select()
    .from(bibliographicReferences)
    .where(eq(bibliographicReferences.id, id))
    .limit(1);
  if (!row) return null;
  const [counts] = await db
    .select({ n: count() })
    .from(traitRecords)
    .where(or(eq(traitRecords.primaryReferenceId, id), eq(traitRecords.secondaryReferenceId, id)));
  return { ...toReference(row), recordCount: counts?.n ?? 0 };
}

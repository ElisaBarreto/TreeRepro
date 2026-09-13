import type { Reference, ReferenceDetail } from '@treerepro/contracts';
import { and, count, desc, eq, ilike, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { traitRecords } from '../db/schema/records.ts';
import { bibliographicReferences, type ReferenceRow } from '../db/schema/references.ts';
import { decodeCompositeCursor, encodeCompositeCursor, isDigits, isUuid } from '../http/cursor.ts';
import { likePattern } from './taxa.ts';

interface Usage {
  primaryCount: number;
  secondaryCount: number;
}

/** @rfc RFC-61 R4 */
export function toReference(row: ReferenceRow, usage: Usage): Reference {
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
    primaryCount: usage.primaryCount,
    secondaryCount: usage.secondaryCount,
  };
}

/**
 * Usage per role, aggregated on demand: one grouped subquery per role over
 * `trait_records`, left-joined to the references, so a record naming the same
 * reference in both roles counts once in each. There are ~1.8k references on
 * the sample and tens of thousands at most on the full dataset, so the two
 * index scans (`trait_records_primary_reference_idx`,
 * `trait_records_secondary_reference_idx`) plus the group-by are cheap enough
 * without a dedicated usage index or a maintained counter.
 */
function usageSubqueries(db: DbExecutor) {
  // Distinct column aliases: an aliased subquery field interpolated into a
  // `sql` template is emitted unqualified, so two `n` columns would be ambiguous.
  const primaryUses = db
    .select({ refId: traitRecords.primaryReferenceId, n: count().as('as_primary') })
    .from(traitRecords)
    .where(isNotNull(traitRecords.primaryReferenceId))
    .groupBy(traitRecords.primaryReferenceId)
    .as('primary_uses');
  const secondaryUses = db
    .select({ refId: traitRecords.secondaryReferenceId, n: count().as('as_secondary') })
    .from(traitRecords)
    .where(isNotNull(traitRecords.secondaryReferenceId))
    .groupBy(traitRecords.secondaryReferenceId)
    .as('secondary_uses');
  const primaryCount = sql<number>`coalesce(${primaryUses.n}, 0)::int`;
  const secondaryCount = sql<number>`coalesce(${secondaryUses.n}, 0)::int`;
  const total = sql<number>`(${primaryCount} + ${secondaryCount})`;
  return { primaryUses, secondaryUses, primaryCount, secondaryCount, total };
}

// A usage total in a cursor: digits that still fit a JS integer, so the bigint
// cast below never sees `Infinity`.
const isUsageCount = (part: string) => isDigits(part) && Number.isSafeInteger(Number(part));

/** Most used first (`primaryCount + secondaryCount` desc, then id desc); composite cursor `[total, id]`. @rfc RFC-61 R4 */
export async function searchReferences(
  db: DbExecutor,
  input: { q?: string; cursor?: string; limit: number },
): Promise<{ data: Reference[]; nextCursor: string | null }> {
  const usage = usageSubqueries(db);
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
      sql`(${usage.total}, ${bibliographicReferences.id}) < (${Number(total)}::bigint, ${id}::uuid)`,
    );
  }
  const rows = await db
    .select({
      reference: bibliographicReferences,
      primaryCount: usage.primaryCount.as('primary_count'),
      secondaryCount: usage.secondaryCount.as('secondary_count'),
      total: usage.total.as('total'),
    })
    .from(bibliographicReferences)
    .leftJoin(usage.primaryUses, eq(usage.primaryUses.refId, bibliographicReferences.id))
    .leftJoin(usage.secondaryUses, eq(usage.secondaryUses.refId, bibliographicReferences.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(usage.total), desc(bibliographicReferences.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page.map((r) => toReference(r.reference, r)),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCompositeCursor([String(last.total), last.reference.id])
        : null,
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
  // One pass over the records naming it: each role counted on its own, and
  // the record itself once even when it names the reference in both roles.
  const [counts] = await db
    .select({
      recordCount: count(),
      primaryCount:
        sql<number>`count(*) filter (where ${traitRecords.primaryReferenceId} = ${id}::uuid)`.mapWith(
          Number,
        ),
      secondaryCount:
        sql<number>`count(*) filter (where ${traitRecords.secondaryReferenceId} = ${id}::uuid)`.mapWith(
          Number,
        ),
    })
    .from(traitRecords)
    .where(or(eq(traitRecords.primaryReferenceId, id), eq(traitRecords.secondaryReferenceId, id)));
  return {
    ...toReference(row, {
      primaryCount: counts?.primaryCount ?? 0,
      secondaryCount: counts?.secondaryCount ?? 0,
    }),
    recordCount: counts?.recordCount ?? 0,
  };
}

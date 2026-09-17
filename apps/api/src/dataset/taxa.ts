import type {
  Genus,
  Species,
  SpeciesListItem,
  SpeciesStatus,
  TaxonRef,
} from '@treerepro/contracts';
import { and, asc, count, countDistinct, eq, ilike, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { speciesVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { plotSpecies } from '../db/schema/plots.ts';
import { traitRecords } from '../db/schema/records.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import { decodeCompositeCursor, encodeCompositeCursor, isUuid, pageOf } from '../http/cursor.ts';

/** Escapes `%`, `_` and `\` so a search term matches literally. @rfc RFC-60 R6 */
export function likePattern(term: string, mode: 'substring' | 'prefix'): string {
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  return mode === 'prefix' ? `${escaped}%` : `%${escaped}%`;
}

/** Ordering by a text column and id needs both values in the cursor. */
function afterNameCursor(cursor: string, nameCol: AnyPgColumn, idCol: AnyPgColumn): SQL {
  const [name, id] = decodeCompositeCursor(cursor, 2, [() => true, isUuid]) as [string, string];
  return sql`(${nameCol}, ${idCol}) > (${name}, ${id}::uuid)`;
}

interface SpeciesJoinedRow {
  id: string;
  canonicalName: string;
  nameSource: SpeciesListItem['nameSource'];
  active: boolean;
  genusId: string | null;
  genusName: string | null;
  familyId: string | null;
  familyName: string | null;
  matchedName: string | null;
}

function toListItem(r: SpeciesJoinedRow): SpeciesListItem {
  return {
    id: r.id,
    canonicalName: r.canonicalName,
    nameSource: r.nameSource,
    active: r.active,
    genus: r.genusId && r.genusName ? { id: r.genusId, name: r.genusName } : null,
    family: r.familyId && r.familyName ? { id: r.familyId, name: r.familyName } : null,
    matchedName: r.matchedName ?? null,
    unresolvedTaxon: r.nameSource !== 'wcvp' || r.genusId === null || r.familyId === null,
  };
}

const speciesColumns = {
  id: species.id,
  canonicalName: species.canonicalName,
  nameSource: species.nameSource,
  active: species.active,
  genusId: genera.id,
  genusName: genera.name,
  familyId: families.id,
  familyName: families.name,
};

/**
 * @rfc RFC-60 R3, R4, R6
 * @rfc RFC-33 R2, R3
 */
export async function searchSpecies(
  db: DbExecutor,
  visibility: Visibility,
  input: {
    q?: string;
    familyId?: string;
    genusId?: string;
    unresolved?: boolean;
    status?: SpeciesStatus;
    cursor?: string;
    limit: number;
    plotId?: string;
  },
): Promise<{ data: SpeciesListItem[]; nextCursor: string | null }> {
  const conditions: SQL[] = [speciesVisible(visibility)];
  if (input.plotId) {
    conditions.push(
      sql`exists (select 1 from ${plotSpecies} ps where ps.plot_id = ${input.plotId} and ps.species_id = ${species.id})`,
    );
  }
  // RFC-60 R6: a restricted viewer's `status` is ignored — the predicate above already
  // keeps only active rows.
  const status = visibility.inactive ? (input.status ?? 'all') : 'active';
  if (status === 'active') conditions.push(eq(species.active, true));
  if (status === 'inactive') conditions.push(eq(species.active, false));
  const pattern = input.q ? likePattern(input.q, 'substring') : undefined;
  if (pattern) {
    // A single `or(ilike, exists(...))` forces a full scan of `species` (the planner
    // can't turn an OR across two tables into an index-only lookup); a semi-join over
    // the UNION of both trigram lookups lets it bitmap-scan each gin index instead.
    conditions.push(
      sql`${species.id} in (
        select s.id from ${species} s where s.canonical_name ilike ${pattern}
        union
        select sn.species_id from ${speciesNames} sn where sn.name ilike ${pattern})`,
    );
  }
  if (input.familyId) conditions.push(eq(genera.familyId, input.familyId));
  if (input.genusId) conditions.push(eq(species.genusId, input.genusId));
  if (input.unresolved) {
    conditions.push(
      sql`(${species.nameSource} <> 'wcvp' or ${species.genusId} is null or ${genera.familyId} is null)`,
    );
  }
  if (input.cursor)
    conditions.push(afterNameCursor(input.cursor, species.canonicalName, species.id));
  const matchedName = pattern
    ? sql<string | null>`case when ${species.canonicalName} ilike ${pattern} then null
        else (select sn.name from ${speciesNames} sn where sn.species_id = ${species.id} and sn.name ilike ${pattern} order by sn.name limit 1) end`
    : sql<string | null>`null`;
  const rows = await db
    .select({ ...speciesColumns, matchedName: matchedName.as('matched_name') })
    .from(species)
    .leftJoin(genera, eq(genera.id, species.genusId))
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(and(...conditions))
    .orderBy(asc(species.canonicalName), asc(species.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([r.canonicalName, r.id]),
  );
  return { data: page.map(toListItem), nextCursor };
}

/**
 * @rfc RFC-60 R3, R7
 * @rfc RFC-33 R2, R4
 */
export async function getSpecies(
  db: DbExecutor,
  visibility: Visibility,
  id: string,
): Promise<Species | null> {
  const [row] = await db
    .select(speciesColumns)
    .from(species)
    .leftJoin(genera, eq(genera.id, species.genusId))
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(and(eq(species.id, id), speciesVisible(visibility)))
    .limit(1);
  if (!row) return null;
  const [names, [counts]] = await Promise.all([
    db
      .select({ name: speciesNames.name, gbifUsageKey: speciesNames.gbifUsageKey })
      .from(speciesNames)
      .where(eq(speciesNames.speciesId, id))
      .orderBy(asc(speciesNames.name)),
    db
      .select({ recordCount: count(), traitCount: countDistinct(traitRecords.traitId) })
      .from(traitRecords)
      .where(eq(traitRecords.speciesId, id)),
  ]);
  return {
    ...toListItem({ ...row, matchedName: null }),
    names: names.map((n) => ({
      name: n.name,
      source: 'gbif' as const,
      gbifUsageKey: n.gbifUsageKey,
    })),
    recordCount: counts?.recordCount ?? 0,
    traitCount: counts?.traitCount ?? 0,
  };
}

/**
 * @rfc RFC-60 R8
 * @rfc RFC-33 R3
 */
export async function listFamilies(
  db: DbExecutor,
  visibility: Visibility,
  input: { cursor?: string; limit: number },
): Promise<{ data: TaxonRef[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (input.cursor) conditions.push(afterNameCursor(input.cursor, families.name, families.id));
  // For an unrestricted viewer `speciesVisible` is `true`, so this `exists` would become
  // "has any species" — a family without species would vanish for admins too.
  if (!visibility.inactive || visibility.plotIds !== null) {
    conditions.push(
      sql`exists (select 1 from ${species} s join ${genera} g on g.id = s.genus_id where g.family_id = ${families.id} and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)})`,
    );
  }
  const rows = await db
    .select({ id: families.id, name: families.name })
    .from(families)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(families.name), asc(families.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([r.name, r.id]),
  );
  return { data: page, nextCursor };
}

/**
 * @rfc RFC-60 R8
 * @rfc RFC-33 R3
 */
export async function listGenera(
  db: DbExecutor,
  visibility: Visibility,
  input: { familyId?: string; q?: string; cursor?: string; limit: number },
): Promise<{ data: Genus[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (input.familyId) conditions.push(eq(genera.familyId, input.familyId));
  if (input.q) conditions.push(ilike(genera.name, likePattern(input.q, 'prefix')));
  if (input.cursor) conditions.push(afterNameCursor(input.cursor, genera.name, genera.id));
  // Same guard as listFamilies: only push for a restricted viewer.
  if (!visibility.inactive || visibility.plotIds !== null) {
    conditions.push(
      sql`exists (select 1 from ${species} s where s.genus_id = ${genera.id} and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)})`,
    );
  }
  const rows = await db
    .select({ id: genera.id, name: genera.name, familyId: families.id, familyName: families.name })
    .from(genera)
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(genera.name), asc(genera.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([r.name, r.id]),
  );
  return {
    data: page.map((g) => ({
      id: g.id,
      name: g.name,
      family: g.familyId && g.familyName ? { id: g.familyId, name: g.familyName } : null,
    })),
    nextCursor,
  };
}

/** @rfc RFC-60 R9 */
export async function getFamily(db: DbExecutor, id: string): Promise<TaxonRef | null> {
  const [row] = await db
    .select({ id: families.id, name: families.name })
    .from(families)
    .where(eq(families.id, id))
    .limit(1);
  return row ?? null;
}

/** @rfc RFC-60 R9 */
export async function getGenus(db: DbExecutor, id: string): Promise<Genus | null> {
  const [row] = await db
    .select({ id: genera.id, name: genera.name, familyId: families.id, familyName: families.name })
    .from(genera)
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(eq(genera.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    family: row.familyId && row.familyName ? { id: row.familyId, name: row.familyName } : null,
  };
}

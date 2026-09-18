import type {
  Genus,
  NameType,
  PlotRef,
  Species,
  SpeciesListItem,
  SpeciesScope,
  SpeciesSort,
  SpeciesStatus,
  TaxonRef,
  TraitDataMode,
} from '@treerepro/contracts';
import { and, asc, count, countDistinct, eq, ilike, inArray, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { speciesTraitCoverage } from '../db/schema/coverage.ts';
import { traitCategories, traits } from '../db/schema/dictionary.ts';
import { plotSpecies, plots } from '../db/schema/plots.ts';
import { traitRecords } from '../db/schema/records.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isDigits,
  isUuid,
  pageOf,
} from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { requireTrait } from './dictionary.ts';

/**
 * Escapes `%`, `_` and `\` so a search term matches literally. `'exact'`
 * carries no wildcard at all: `canonical_name ilike <pattern>` is then a
 * case-insensitive equality the trigram index still serves (RFC-60 R6 tier
 * 1) — unlike `'substring'`'s `%…%`, which needs the wildcards to match
 * partway through the name, and unlike a `lower(canonical_name) = …`
 * predicate, which has no index to use here at all.
 * @rfc RFC-60 R6
 */
export function likePattern(term: string, mode: 'substring' | 'prefix' | 'exact'): string {
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  if (mode === 'prefix') return `${escaped}%`;
  if (mode === 'exact') return escaped;
  return `%${escaped}%`;
}

/** Ordering by a text column and id needs both values in the cursor. */
function afterNameCursor(cursor: string, nameCol: AnyPgColumn, idCol: AnyPgColumn): SQL {
  const [name, id] = decodeCompositeCursor(cursor, 2, [() => true, isUuid]) as [string, string];
  return sql`(${nameCol}, ${idCol}) > (${name}, ${id}::uuid)`;
}

// A `trait_count` in a cursor: digits that still fit the `int` the predicate
// below casts to, so a tampered token answers 400 instead of an out-of-range
// driver error.
const isTraitCount = (part: string) => isDigits(part) && Number(part) <= 2_147_483_647;

// The tier key in a cursor: only '0', '1' or '2', RFC-60 R6's three search
// tiers — not `isDigits`, which would also accept e.g. '7'. `Number('7') as
// 0|1|2` is still 7 at runtime; `tier === 1` is false, so it falls through
// to the tier-2 branch while `pattern` (gated on `tier === 2` in
// `searchSpecies`) stays undefined, carrying tier-2 rows with
// `matchedName`/`matchedNameType` null — a silent mis-decode, not the 400
// `VALIDATION_FAILED` on `cursor` a bad cursor must always answer with.
const isTier = (part: string) => part === '0' || part === '1' || part === '2';

/**
 * The species list's cursor carries a leading tier key ahead of its ordering
 * keyset (RFC-60 R6): `[tier, name, id]` under `sort=name`, `[tier,
 * traitCount, name, id]` under `sort=completeness` — one part longer than
 * before plan 10b, so the inherited per-sort arity check
 * ({@link decodeCompositeCursor}) still answers 400 `VALIDATION_FAILED` on
 * `cursor` for a cursor minted under the other sort, never a silent
 * mis-decode.
 * @rfc RFC-60 R6
 * @rfc RFC-11 R6
 */
function decodeSpeciesCursor(cursor: string, sort: SpeciesSort): { tier: string; predicate: SQL } {
  if (sort === 'completeness') {
    const [tier, traitCount, name, id] = decodeCompositeCursor(cursor, 4, [
      isTier,
      isTraitCount,
      () => true,
      isUuid,
    ]) as [string, string, string, string];
    return {
      tier,
      predicate: sql`(${species.traitCount}, ${species.canonicalName}, ${species.id}) > (${Number(traitCount)}::int, ${name}, ${id}::uuid)`,
    };
  }
  const [tier, name, id] = decodeCompositeCursor(cursor, 3, [isTier, () => true, isUuid]) as [
    string,
    string,
    string,
  ];
  return {
    tier,
    predicate: sql`(${species.canonicalName}, ${species.id}) > (${name}, ${id}::uuid)`,
  };
}

/**
 * RFC-60 R6 tier 1: does any species under the given base conditions —
 * visibility, plot scope, status, the taxonomy filters, the trait filters,
 * everything {@link speciesListConditions} builds before `q` — have `q` as
 * its canonical name, case-insensitively? One cheap lookup (`limit 1`) that
 * the trigram index serves because `likePattern`'s `'exact'` mode carries no
 * wildcard.
 * @rfc RFC-60 R6
 */
async function firstTier(db: DbExecutor, baseConditions: SQL[], q: string): Promise<1 | 2> {
  const [row] = await db
    .select({ id: species.id })
    .from(species)
    .leftJoin(genera, eq(genera.id, species.genusId))
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(and(...baseConditions, ilike(species.canonicalName, likePattern(q, 'exact'))))
    .limit(1);
  return row ? 1 : 2;
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
  matchedNameType: NameType | null;
  traitCount: number;
  traitRecordCount?: number | null;
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
    matchedNameType: r.matchedNameType ?? null,
    unresolvedTaxon: r.nameSource !== 'wcvp' || r.genusId === null || r.familyId === null,
    traitCount: r.traitCount,
    traitRecordCount: r.traitRecordCount ?? null,
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
 * Every filter `GET /api/species` accepts (RFC-60 R6) plus the keyset cursor
 * that pages it. `speciesListConditions` turns them into predicates;
 * `searchSpecies` runs them, and so does `GET /api/traits/:id/species`
 * (RFC-62 R8) through it, so visibility, plot scope, the taxonomy filters
 * and the cursor have one implementation.
 * @rfc RFC-60 R6
 */
export interface SpeciesListFilters {
  q?: string;
  familyId?: string;
  genusId?: string;
  unresolved?: boolean;
  status?: SpeciesStatus;
  scope?: SpeciesScope;
  plotId?: string;
  /** The plots the viewer is assigned to, whether or not they are restricted. */
  viewerPlotIds?: string[];
  categoryKey?: string;
  traitId?: string;
  traitData?: TraitDataMode;
  sort?: SpeciesSort;
  cursor?: string;
}

/**
 * The `where` of the species list: visibility, plot scope, status, the search
 * term, the taxonomy filters, the trait-coverage filter and the cursor — every
 * predicate `searchSpecies` applies. The caller runs them over `species` left
 * joined to `genera` and `families` (`familyId` and `unresolved` read
 * `genera.family_id`) and orders the rows the way `filters.sort` names, since
 * the cursor predicate decodes that keyset.
 *
 * `traitData` without `traitId` or `categoryKey` is ignored: the spec names no
 * error for it, and the filter it would apply is undefined.
 *
 * `tier` is RFC-60 R6's search tier: `0` without `q`, else `1` (the canonical
 * name equals `q` exactly, case-insensitively) or `2` (today's substring
 * match, over the canonical name or any alternative name) — never both. A
 * cursor already names its tier ({@link decodeSpeciesCursor}), so a later page
 * reuses it instead of re-running {@link firstTier}; the first page decides it
 * fresh, under every other condition here (visibility, plot scope, status,
 * the taxonomy filters, the trait filters) but never `q` or the cursor
 * itself, which is what the tier is decided over and paged within.
 * @rfc RFC-60 R3, R4, R6
 * @rfc RFC-33 R2, R3, R6
 * @rfc RFC-62 R8
 * @rfc RFC-69 R4
 */
export async function speciesListConditions(
  db: DbExecutor,
  visibility: Visibility,
  filters: SpeciesListFilters,
): Promise<{ conditions: SQL[]; tier: 0 | 1 | 2 }> {
  const conditions: SQL[] = [speciesVisible(visibility)];
  const viewerPlotIds = filters.viewerPlotIds ?? [];

  if (filters.plotId) {
    const [plotRow] = await db
      .select({ id: plots.id })
      .from(plots)
      .where(eq(plots.id, filters.plotId))
      .limit(1);
    if (!plotRow) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');

    if (visibility.plotIds !== null && !visibility.plotIds.includes(filters.plotId)) {
      throw new AppError('PERMISSION_DENIED', 'Cannot view species outside assigned plots');
    }

    conditions.push(
      sql`exists (select 1 from ${plotSpecies} ps where ps.plot_id = ${filters.plotId} and ps.species_id = ${species.id})`,
    );
  } else {
    const defaultScope: SpeciesScope =
      visibility.plotIds !== null || (viewerPlotIds.length > 0 && !visibility.inactive)
        ? 'plots'
        : 'all';
    const resolvedScope = filters.scope ?? defaultScope;

    if (resolvedScope === 'all') {
      if (visibility.plotIds !== null) {
        throw new AppError(
          'PERMISSION_DENIED',
          'Restricted user cannot view species outside assigned plots',
        );
      }
    } else {
      if (viewerPlotIds.length === 0) {
        conditions.push(sql`false`);
      } else {
        conditions.push(
          sql`exists (select 1 from ${plotSpecies} ps where ps.species_id = ${species.id} and ps.plot_id = any(${sql.param(viewerPlotIds)}::uuid[]))`,
        );
      }
    }
  }

  // RFC-60 R6: a restricted viewer's `status` is ignored — the predicate above already
  // keeps only active rows.
  const status = visibility.inactive ? (filters.status ?? 'all') : 'active';
  if (status === 'active') conditions.push(eq(species.active, true));
  if (status === 'inactive') conditions.push(eq(species.active, false));
  if (filters.familyId) conditions.push(eq(genera.familyId, filters.familyId));
  if (filters.genusId) conditions.push(eq(species.genusId, filters.genusId));
  if (filters.unresolved) {
    conditions.push(
      sql`(${species.nameSource} <> 'wcvp' or ${species.genusId} is null or ${genera.familyId} is null)`,
    );
  }

  // RFC-69 R4: `species_trait_coverage` has no flags of its own, so the trait
  // side of visibility is the join on `traits`; the species side is already in
  // `conditions`.
  const coverageExists = (traitFilter: SQL) =>
    sql`exists (select 1 from ${speciesTraitCoverage} c join ${traits} t on t.id = c.trait_id
      where c.species_id = ${species.id} and ${traitFilter} and ${traitVisible(visibility, sql`t.active`)})`;
  if (filters.traitId) {
    const trait = await requireTrait(db, visibility, filters.traitId);
    if (filters.categoryKey && trait.categoryKey !== filters.categoryKey) {
      throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
        { path: 'categoryKey', message: 'Trait is not in this category' },
      ]);
    }
    const e = coverageExists(sql`c.trait_id = ${filters.traitId}::uuid`);
    conditions.push(filters.traitData === 'missing' ? sql`not ${e}` : e);
  } else if (filters.categoryKey) {
    const [category] = await db
      .select({ key: traitCategories.key })
      .from(traitCategories)
      .where(eq(traitCategories.key, filters.categoryKey))
      .limit(1);
    if (!category) {
      throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
        { path: 'categoryKey', message: 'Unknown trait category' },
      ]);
    }
    const e = coverageExists(sql`t.category_key = ${filters.categoryKey}`);
    conditions.push(filters.traitData === 'missing' ? sql`not ${e}` : e);
  }

  // Everything above is the base conditions RFC-60 R6's search tiers are
  // decided and paged under — visibility, plot scope, status, the taxonomy
  // filters, the trait filters — but never `q` or the cursor.
  const sort = filters.sort ?? 'name';
  const cursorInfo = filters.cursor ? decodeSpeciesCursor(filters.cursor, sort) : null;
  let tier: 0 | 1 | 2 = 0;
  if (filters.q) {
    tier = cursorInfo
      ? (Number(cursorInfo.tier) as 0 | 1 | 2)
      : await firstTier(db, conditions, filters.q);
    conditions.push(
      tier === 1
        ? ilike(species.canonicalName, likePattern(filters.q, 'exact'))
        : // A single `or(ilike, exists(...))` forces a full scan of `species` (the planner
          // can't turn an OR across two tables into an index-only lookup); a semi-join over
          // the UNION of both trigram lookups lets it bitmap-scan each gin index instead.
          sql`${species.id} in (
        select s.id from ${species} s where s.canonical_name ilike ${likePattern(filters.q, 'substring')}
        union
        select sn.species_id from ${speciesNames} sn where sn.name ilike ${likePattern(filters.q, 'substring')})`,
    );
  }
  if (cursorInfo) conditions.push(cursorInfo.predicate);
  return { conditions, tier };
}

/**
 * One page of the species list: the filters of {@link speciesListConditions}
 * over the joined select every species row is built from.
 * @rfc RFC-60 R3, R4, R6
 * @rfc RFC-33 R2, R3
 * @rfc RFC-69 R4
 */
export async function searchSpecies(
  db: DbExecutor,
  visibility: Visibility,
  input: SpeciesListFilters & { limit: number },
): Promise<{ data: SpeciesListItem[]; nextCursor: string | null }> {
  const { conditions, tier } = await speciesListConditions(db, visibility, input);
  // The twin of the tier 2 predicate `speciesListConditions` built: if the two
  // ever disagree, a row can match without a `matchedName` or the other way
  // round. They change together. Tier 1's `q` matched the canonical name
  // exactly, so `matchedName`/`matchedNameType` are always null there (RFC-60
  // R6) — no pattern is even built.
  const pattern = input.q && tier === 2 ? likePattern(input.q, 'substring') : undefined;
  // The same choice the cursor predicate made in `speciesListConditions`.
  const sort: SpeciesSort = input.sort ?? 'name';
  // `null` unless a trait was named; the coverage row's `record_count`
  // otherwise, and 0 in missing mode — where no row exists by construction.
  const traitRecordCount = input.traitId
    ? sql<
        number | null
      >`coalesce((select c.record_count from ${speciesTraitCoverage} c where c.species_id = ${species.id} and c.trait_id = ${input.traitId}::uuid), 0)`
    : sql<number | null>`null::int`;
  const matchedName = pattern
    ? sql<string | null>`case when ${species.canonicalName} ilike ${pattern} then null
        else (select sn.name from ${speciesNames} sn where sn.species_id = ${species.id} and sn.name ilike ${pattern} order by sn.name limit 1) end`
    : sql<string | null>`null`;
  const matchedNameType = pattern
    ? sql<NameType | null>`case when ${species.canonicalName} ilike ${pattern} then null
        else (select sn.name_type from ${speciesNames} sn where sn.species_id = ${species.id} and sn.name ilike ${pattern} order by sn.name limit 1) end`
    : sql<NameType | null>`null`;
  const rows = await db
    .select({
      ...speciesColumns,
      // RFC-69 R1's maintained counter: the list's coarse coverage guide, and
      // the completeness keyset's leading column.
      traitCount: species.traitCount,
      matchedName: matchedName.as('matched_name'),
      matchedNameType: matchedNameType.as('matched_name_type'),
      traitRecordCount: traitRecordCount.as('trait_record_count'),
    })
    .from(species)
    .leftJoin(genera, eq(genera.id, species.genusId))
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(and(...conditions))
    .orderBy(
      ...(sort === 'completeness'
        ? [asc(species.traitCount), asc(species.canonicalName), asc(species.id)]
        : [asc(species.canonicalName), asc(species.id)]),
    )
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    sort === 'completeness'
      ? encodeCompositeCursor([String(tier), String(r.traitCount), r.canonicalName, r.id])
      : encodeCompositeCursor([String(tier), r.canonicalName, r.id]),
  );
  return { data: page.map(toListItem), nextCursor };
}

/**
 * @rfc RFC-60 R3, R7
 * @rfc RFC-33 R2, R4
 * @rfc RFC-67 R8
 */
export async function getSpecies(
  db: DbExecutor,
  visibility: Visibility,
  id: string,
  opts: { viewerPlotIds?: string[]; allPlots?: boolean } = {},
): Promise<Species | null> {
  const [row] = await db
    .select(speciesColumns)
    .from(species)
    .leftJoin(genera, eq(genera.id, species.genusId))
    .leftJoin(families, eq(families.id, genera.familyId))
    .where(and(eq(species.id, id), speciesVisible(visibility)))
    .limit(1);
  if (!row) return null;

  let speciesPlotsQuery: Promise<PlotRef[]>;
  if (opts.allPlots) {
    speciesPlotsQuery = db
      .select({ id: plots.id, code: plots.code, name: plots.name })
      .from(plotSpecies)
      .innerJoin(plots, eq(plots.id, plotSpecies.plotId))
      .where(eq(plotSpecies.speciesId, id))
      .orderBy(asc(plots.code), asc(plots.id));
  } else if (opts.viewerPlotIds && opts.viewerPlotIds.length > 0) {
    speciesPlotsQuery = db
      .select({ id: plots.id, code: plots.code, name: plots.name })
      .from(plotSpecies)
      .innerJoin(plots, eq(plots.id, plotSpecies.plotId))
      .where(and(eq(plotSpecies.speciesId, id), inArray(plotSpecies.plotId, opts.viewerPlotIds)))
      .orderBy(asc(plots.code), asc(plots.id));
  } else {
    speciesPlotsQuery = Promise.resolve([]);
  }

  const [names, [counts], speciesPlots] = await Promise.all([
    db
      .select({
        name: speciesNames.name,
        nameType: speciesNames.nameType,
        language: speciesNames.language,
        source: speciesNames.source,
        gbifUsageKey: speciesNames.gbifUsageKey,
      })
      .from(speciesNames)
      .where(eq(speciesNames.speciesId, id))
      // RFC-60 R7: gbif, synonym, common, then name.
      .orderBy(
        sql`case ${speciesNames.nameType} when 'gbif' then 0 when 'synonym' then 1 else 2 end`,
        asc(speciesNames.name),
      ),
    db
      .select({ recordCount: count(), traitCount: countDistinct(traitRecords.traitId) })
      .from(traitRecords)
      .where(eq(traitRecords.speciesId, id)),
    speciesPlotsQuery,
  ]);
  // `traitRecordCount` answers "records for the one filtered trait" and the
  // detail route takes no trait, so the contract omits it from `speciesSchema`;
  // dropped here so the body carries exactly the contract's keys.
  // R7's `traitCount` is counted live from the records this same read already
  // aggregates, rather than read from `species.trait_count` (R6's maintained
  // guide): the two are meant to agree, and the page that shows `recordCount`
  // counts the traits behind it itself. A test compares the live count with
  // the column on rows it has just created, which pins the trigger's
  // arithmetic; nothing detects drift on a row that was written earlier.
  const { traitRecordCount: _listOnly, ...listItem } = toListItem({
    ...row,
    matchedName: null,
    matchedNameType: null,
    traitCount: counts?.traitCount ?? 0,
  });
  return {
    ...listItem,
    plots: speciesPlots,
    names: names.map((n) => ({
      name: n.name,
      nameType: n.nameType,
      language: n.language,
      source: n.source,
      gbifUsageKey: n.gbifUsageKey,
    })),
    recordCount: counts?.recordCount ?? 0,
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

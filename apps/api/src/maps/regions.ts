import {
  MAP_KINDS,
  type MapEntry,
  type MapKind,
  type MapValues,
  type MapValuesQuery,
} from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import { levelVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { AppError } from '../http/errors.ts';
import { colourScale, fillColour, KIND_STYLE, RAMPS } from './colour.ts';

/** A region's value rests on at least this many species, except completeness (RFC-76 R3). @rfc RFC-76 R3 */
export const MIN_SPECIES = 3;

const CONTINUOUS_KINDS = ['mean', 'median', 'sd', 'cv', 'min', 'max'] as const;
type ContinuousKind = (typeof CONTINUOUS_KINDS)[number];

/** The snapshot's time, or null before the first snapshot. */
async function snapshotTime(db: DbExecutor): Promise<string | null> {
  const [row] = (await db.execute(
    sql`select computed_at as "computedAt" from region_snapshot where id`,
  )) as unknown as { computedAt: Date | string }[];
  return row ? new Date(row.computedAt).toISOString() : null;
}

/**
 * The maps a viewer may see (RFC-76 R5): one entry per map with at least one
 * region with a value, on a visible trait whose value type fits the kind and,
 * for prevalence, a visible state; by trait key, kind and state. No plot filter.
 * @rfc RFC-76 R1, R3, R5
 */
export async function listMaps(db: DbExecutor, visibility: Visibility): Promise<MapEntry[]> {
  const computedAt = await snapshotTime(db);
  if (computedAt === null) return [];
  const rows = (await db.execute(sql`
    select t.id as "traitId", t.key, 'completeness' as kind, null::uuid as "levelId", 0 as sort,
      count(*) filter (where c.wcvp_tree_species > 0)::int as regions
    from region_completeness c join traits t on t.id = c.trait_id
    where ${traitVisible(visibility, sql`t.active`)}
    group by t.id, t.key
    union all
    select t.id, t.key, k.kind, null, 0,
      count(*) filter (where n.n_species >= ${MIN_SPECIES} and case k.kind
        when 'sd' then n.sd is not null when 'cv' then n.cv is not null else true end)::int
    from region_continuous n join traits t on t.id = n.trait_id
    cross join (values ('mean'), ('median'), ('sd'), ('cv'), ('min'), ('max')) as k(kind)
    where t.value_type = 'quantitative' and ${traitVisible(visibility, sql`t.active`)}
    group by t.id, t.key, k.kind
    union all
    select t.id, t.key, 'prevalence', l.id, l.sort_order,
      count(*) filter (where g.n_species_with_trait >= ${MIN_SPECIES})::int
    from region_categorical g join traits t on t.id = g.trait_id join trait_levels l on l.id = g.level_id
    where t.value_type = 'categorical' and ${traitVisible(visibility, sql`t.active`)}
      and ${levelVisible(visibility, sql`l.active`)}
    group by t.id, t.key, l.id, l.sort_order`)) as unknown as {
    traitId: string;
    key: string;
    kind: MapKind;
    levelId: string | null;
    sort: number;
    regions: number;
  }[];
  const kindOrder = (kind: MapKind) => MAP_KINDS.indexOf(kind);
  return rows
    .filter((r) => r.regions > 0)
    .sort(
      (a, b) =>
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
        kindOrder(a.kind) - kindOrder(b.kind) ||
        a.sort - b.sort,
    )
    .map((r) => ({
      traitId: r.traitId,
      kind: r.kind,
      levelId: r.levelId,
      regions: r.regions,
      computedAt,
    }));
}

interface RegionRow {
  code: string;
  name: string;
  value: number | null;
  nSpecies: number;
}

/** R3's value and species count of every region with a row, for one map. */
async function regionRows(db: DbExecutor, query: MapValuesQuery): Promise<RegionRow[]> {
  const name = sql`coalesce((select w.name from wcvp_regions w where w.area_code_l3 = x.area_code_l3), x.area_code_l3)`;
  if (query.kind === 'completeness') {
    return (await db.execute(sql`
      select x.area_code_l3 as code, ${name} as name, x.species_with_data as "nSpecies",
        case when x.wcvp_tree_species > 0
             then 100.0 * x.species_with_data / x.wcvp_tree_species end::float8 as value
      from region_completeness x where x.trait_id = ${query.traitId}::uuid
      order by x.area_code_l3`)) as unknown as RegionRow[];
  }
  if (query.kind === 'prevalence') {
    return (await db.execute(sql`
      select x.area_code_l3 as code, ${name} as name, x.n_species_with_trait as "nSpecies",
        case when x.n_species_with_trait >= ${MIN_SPECIES}
             then 100.0 * x.n_species_with_level / x.n_species_with_trait end::float8 as value
      from region_categorical x
      where x.trait_id = ${query.traitId}::uuid and x.level_id = ${query.levelId ?? null}::uuid
      order by x.area_code_l3`)) as unknown as RegionRow[];
  }
  const column = sql.raw(query.kind satisfies ContinuousKind);
  return (await db.execute(sql`
    select x.area_code_l3 as code, ${name} as name, x.n_species as "nSpecies",
      case when x.n_species >= ${MIN_SPECIES} then x.${column} end::float8 as value
    from region_continuous x where x.trait_id = ${query.traitId}::uuid
    order by x.area_code_l3`)) as unknown as RegionRow[];
}

/**
 * One map's regions and legend (RFC-76 R6): every region with a row, its
 * value (null below the species minimum), species count and fill. A map
 * `listMaps` would not give this viewer answers 404 `MAP_NOT_FOUND`.
 * @rfc RFC-76 R3, R4, R6
 */
export async function mapValues(
  db: DbExecutor,
  visibility: Visibility,
  query: MapValuesQuery,
): Promise<MapValues> {
  const entry = (await listMaps(db, visibility)).find(
    (m) =>
      m.traitId === query.traitId && m.kind === query.kind && m.levelId === (query.levelId ?? null),
  );
  if (!entry) throw new AppError('MAP_NOT_FOUND', 'Map not found');
  const rows = await regionRows(db, query);
  const values = rows.flatMap((r) => (r.value === null ? [] : [r.value]));
  const scale = colourScale(query.kind, values);
  const style = KIND_STYLE[query.kind];
  const [trait] = (await db.execute(
    sql`select unit from traits where id = ${query.traitId}::uuid`,
  )) as unknown as { unit: string | null }[];
  return {
    regions: rows.map((r) => ({ ...r, fill: fillColour(query.kind, r.value, scale) })),
    legend: {
      stops: [...RAMPS[style.ramp]],
      limits: scale.limits,
      log: scale.log,
      percent: scale.percent,
      label: style.label,
      unit: style.percent || query.kind === 'cv' ? null : (trait?.unit ?? null),
    },
    computedAt: entry.computedAt,
  };
}

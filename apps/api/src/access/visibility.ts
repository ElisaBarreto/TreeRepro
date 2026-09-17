import type { SQL } from 'drizzle-orm';
import { eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { plotSpecies, userPlots } from '../db/schema/plots.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import type { AppEnv } from '../http/env.ts';
import { currentPermissions } from '../http/middleware/require-permission.ts';
import type { AccessContext } from './context.ts';

/**
 * What one viewer may see (RFC-33 R1).
 * @rfc RFC-33 R1
 */
export interface Visibility {
  inactive: boolean;
  plotIds: string[] | null;
}

/** A viewer who sees everything: CLI commands, migrations, admin-only services. @rfc RFC-33 R1 */
export const UNRESTRICTED: Visibility = { inactive: true, plotIds: null };

/** @rfc RFC-33 R1 */
export function visibilityFor(
  permissions: ReadonlySet<string>,
  plotSettings?: { restricted: boolean; plotIds: string[] },
): Visibility {
  return {
    inactive: permissions.has('dataset.read_inactive'),
    plotIds: plotSettings?.restricted ? plotSettings.plotIds : null,
  };
}

/**
 * The viewer of the current request; computed once and kept on the context.
 * @rfc RFC-33 R1
 * @rfc RFC-67 R6
 */
export async function visibilityOf(ctx: AccessContext, c: Context<AppEnv>): Promise<Visibility> {
  const cached = c.get('visibility');
  if (cached) return cached;
  const user = c.get('user');
  let plotIds: string[] | null = null;
  if (user) {
    const [row] = await ctx.db
      .select({
        restricted: users.restrictToAssignedPlots,
        plotIds: sql<
          string[] | null
        >`array_agg(${userPlots.plotId}) filter (where ${userPlots.plotId} is not null)`,
      })
      .from(users)
      .leftJoin(userPlots, eq(userPlots.userId, users.id))
      .where(eq(users.id, user.id))
      .groupBy(users.id, users.restrictToAssignedPlots);
    if (row?.restricted) {
      plotIds = row.plotIds ?? [];
    }
  }
  const v = visibilityFor(currentPermissions(c), {
    restricted: plotIds !== null,
    plotIds: plotIds ?? [],
  });
  c.set('visibility', v);
  return v;
}

/**
 * `species` row predicate; `activeCol` and `idCol` allow joined aliases to be used.
 * @rfc RFC-33 R2
 * @rfc RFC-67 R6
 */
export function speciesVisible(
  v: Visibility,
  activeCol: SQL | typeof species.active = species.active,
  idCol: SQL | typeof species.id = species.id,
): SQL {
  const activePred = v.inactive ? sql`true` : sql`${activeCol}`;
  if (v.plotIds === null) {
    return activePred;
  }
  if (v.plotIds.length === 0) {
    return sql`false`;
  }
  const plotPred = sql`exists (select 1 from ${plotSpecies} ps where ps.species_id = ${idCol} and ps.plot_id = any(${sql.param(v.plotIds)}::uuid[]))`;
  return sql`(${activePred}) and (${plotPred})`;
}

/** @rfc RFC-33 R2 */
export function traitVisible(
  v: Visibility,
  activeCol: SQL | typeof traits.active = traits.active,
): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}

/** @rfc RFC-33 R2 */
export function levelVisible(
  v: Visibility,
  activeCol: SQL | typeof traitLevels.active = traitLevels.active,
): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}

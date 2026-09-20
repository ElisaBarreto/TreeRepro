import type {
  CreatePlotBody,
  Plot,
  PlotDetail,
  PlotUser,
  SpeciesListItem,
  UpdatePlotBody,
} from '@treerepro/contracts';
import { and, asc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import type { Visibility } from '../access/visibility.ts';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { plotSpecies, plots, userPlots } from '../db/schema/plots.ts';
import { species } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import { decodeCompositeCursor, encodeCompositeCursor, isUuid, pageOf } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { likePattern, searchSpecies } from './taxa.ts';

function afterCodeCursor(cursor: string): SQL {
  const [code, id] = decodeCompositeCursor(cursor, 2, [() => true, isUuid]) as [string, string];
  return sql`(${plots.code}, ${plots.id}) > (${code}, ${id}::uuid)`;
}

const speciesCountSql = sql<number>`coalesce((select count(*)::int from ${plotSpecies} ps where ps.plot_id = ${plots.id}), 0)`;

/**
 * Lists field plots by code then id.
 * @rfc RFC-67 R3
 */
export async function listPlots(
  db: DbExecutor,
  input: { q?: string; cursor?: string; limit: number },
): Promise<{ data: Plot[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];

  if (input.q) {
    const prefix = likePattern(input.q, 'prefix');
    const substring = likePattern(input.q, 'substring');
    conditions.push(or(ilike(plots.code, prefix), ilike(plots.name, substring)) as SQL);
  }

  if (input.cursor) {
    conditions.push(afterCodeCursor(input.cursor));
  }

  const rows = await db
    .select({
      id: plots.id,
      code: plots.code,
      name: plots.name,
      description: plots.description,
      latitude: plots.latitude,
      longitude: plots.longitude,
      country: plots.country,
      biome: plots.biome,
      speciesCount: speciesCountSql.as('species_count'),
      createdAt: plots.createdAt,
      updatedAt: plots.updatedAt,
    })
    .from(plots)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(plots.code), asc(plots.id))
    .limit(input.limit + 1);

  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([r.code, r.id]),
  );

  const data: Plot[] = page.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    biome: r.biome,
    speciesCount: r.speciesCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return { data, nextCursor };
}

/**
 * Gets plot details, conditionally including userCount for plots.manage holders.
 * @rfc RFC-67 R3
 */
export async function getPlot(
  db: DbExecutor,
  id: string,
  opts: { withUserCount: boolean },
): Promise<PlotDetail | null> {
  const userCountSql = opts.withUserCount
    ? sql<number>`coalesce((select count(*)::int from ${userPlots} up where up.plot_id = ${plots.id}), 0)`
    : sql<null>`null`;

  const [row] = await db
    .select({
      id: plots.id,
      code: plots.code,
      name: plots.name,
      description: plots.description,
      latitude: plots.latitude,
      longitude: plots.longitude,
      country: plots.country,
      biome: plots.biome,
      speciesCount: speciesCountSql.as('species_count'),
      userCount: userCountSql.as('user_count'),
      createdAt: plots.createdAt,
      updatedAt: plots.updatedAt,
    })
    .from(plots)
    .where(eq(plots.id, id))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    country: row.country,
    biome: row.biome,
    speciesCount: row.speciesCount,
    userCount: row.userCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Lists species in a plot, respecting visibility rules.
 * @rfc RFC-67 R4
 */
export async function listPlotSpecies(
  db: DbExecutor,
  visibility: Visibility,
  plotId: string,
  input: { q?: string; cursor?: string; limit: number },
): Promise<{ data: SpeciesListItem[]; nextCursor: string | null }> {
  const [plot] = await db.select({ id: plots.id }).from(plots).where(eq(plots.id, plotId)).limit(1);
  if (!plot) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');

  return searchSpecies(db, visibility, { ...input, plotId });
}

/**
 * Lists users assigned to a field plot, sorted by decrypted name. The item
 * never carries the e-mail address (RFC-02 R14): the route is `plots.manage`,
 * and the address stays behind `users.read`.
 * @rfc RFC-67 R4
 * @rfc RFC-02 R14
 */
export async function listPlotUsers(
  db: DbExecutor,
  plotId: string,
  input: { cursor?: string; limit: number },
): Promise<{ data: PlotUser[]; nextCursor: string | null }> {
  const [plot] = await db.select({ id: plots.id }).from(plots).where(eq(plots.id, plotId)).limit(1);
  if (!plot) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      status: users.status,
      restricted: users.restrictToAssignedPlots,
    })
    .from(userPlots)
    .innerJoin(users, eq(users.id, userPlots.userId))
    .where(eq(userPlots.plotId, plotId));

  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  let sorted = rows;
  if (input.cursor) {
    const cursorIdx = sorted.findIndex((u) => u.id === input.cursor);
    if (cursorIdx >= 0) {
      sorted = sorted.slice(cursorIdx + 1);
    }
  }

  const page = sorted.slice(0, input.limit);
  const last = page[page.length - 1];
  const nextCursor = sorted.length > input.limit && last ? last.id : null;

  return { data: page, nextCursor };
}

/**
 * Creates a field plot and audits the action.
 * @rfc RFC-67 R5
 */
export async function createPlot(
  db: DbExecutor,
  input: CreatePlotBody & { actorId: string },
): Promise<PlotDetail> {
  return db.transaction(async (tx) => {
    let row: typeof plots.$inferSelect | undefined;
    try {
      [row] = await tx
        .insert(plots)
        .values({
          code: input.code.trim(),
          name: input.name.trim(),
          description: input.description?.trim() ?? '',
          latitude: input.latitude,
          longitude: input.longitude,
          country: input.country?.trim(),
          biome: input.biome?.trim(),
          createdBy: input.actorId,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('PLOT_CODE_TAKEN', 'A plot with this code already exists');
      }
      throw err;
    }

    if (!row) throw new Error('createPlot: insert returned no row');

    await recordAudit(tx, {
      actorUserId: input.actorId,
      action: 'plots.created',
      targetType: 'plots',
      targetId: row.id,
      metadata: {},
    });

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      latitude: row.latitude,
      longitude: row.longitude,
      country: row.country,
      biome: row.biome,
      speciesCount: 0,
      userCount: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/**
 * Updates a field plot and audits modified fields.
 * @rfc RFC-67 R5
 */
export async function updatePlot(
  db: DbExecutor,
  id: string,
  input: UpdatePlotBody & { actorId: string },
): Promise<PlotDetail> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(plots).where(eq(plots.id, id)).limit(1).for('update');
    if (!current) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');

    const fields: string[] = [];
    const patch: Partial<typeof plots.$inferInsert> = {};

    if (input.code !== undefined && input.code.trim() !== current.code) {
      fields.push('code');
      patch.code = input.code.trim();
    }
    if (input.name !== undefined && input.name.trim() !== current.name) {
      fields.push('name');
      patch.name = input.name.trim();
    }
    if (input.description !== undefined && input.description.trim() !== current.description) {
      fields.push('description');
      patch.description = input.description.trim();
    }
    if (input.latitude !== undefined && input.latitude !== current.latitude) {
      fields.push('latitude');
      patch.latitude = input.latitude;
    }
    if (input.longitude !== undefined && input.longitude !== current.longitude) {
      fields.push('longitude');
      patch.longitude = input.longitude;
    }
    if (input.country !== undefined) {
      const next = input.country === null ? null : input.country.trim();
      if (next !== current.country) {
        fields.push('country');
        patch.country = next;
      }
    }
    if (input.biome !== undefined) {
      const next = input.biome === null ? null : input.biome.trim();
      if (next !== current.biome) {
        fields.push('biome');
        patch.biome = next;
      }
    }

    if (fields.length === 0) {
      const detail = await getPlot(tx, id, { withUserCount: true });
      if (!detail) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');
      return detail;
    }

    patch.updatedAt = new Date();

    try {
      await tx.update(plots).set(patch).where(eq(plots.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('PLOT_CODE_TAKEN', 'A plot with this code already exists');
      }
      throw err;
    }

    await recordAudit(tx, {
      actorUserId: input.actorId,
      action: 'plots.updated',
      targetType: 'plots',
      targetId: id,
      metadata: { fields },
    });

    const detail = await getPlot(tx, id, { withUserCount: true });
    if (!detail) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');
    return detail;
  });
}

/**
 * Adds a species to a field plot.
 * @rfc RFC-67 R5
 */
export async function addPlotSpeciesMember(
  db: DbExecutor,
  plotId: string,
  speciesId: string,
  actorId: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const [plot] = await tx
      .select({ id: plots.id })
      .from(plots)
      .where(eq(plots.id, plotId))
      .limit(1);
    if (!plot) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');

    const [sp] = await tx
      .select({ id: species.id })
      .from(species)
      .where(eq(species.id, speciesId))
      .limit(1);
    if (!sp) throw new AppError('SPECIES_NOT_FOUND', 'Species not found');

    try {
      await tx.insert(plotSpecies).values({ plotId, speciesId });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('PLOT_SPECIES_EXISTS', 'The species is already in this plot');
      }
      throw err;
    }

    await recordAudit(tx, {
      actorUserId: actorId,
      action: 'plots.species_added',
      targetType: 'plots',
      targetId: plotId,
      metadata: { speciesId },
    });
  });
}

/**
 * Removes a species from a field plot.
 * @rfc RFC-67 R5
 */
export async function removePlotSpeciesMember(
  db: DbExecutor,
  plotId: string,
  speciesId: string,
  actorId: string,
): Promise<void> {
  return db.transaction(async (tx) => {
    const [plot] = await tx
      .select({ id: plots.id })
      .from(plots)
      .where(eq(plots.id, plotId))
      .limit(1);
    if (!plot) throw new AppError('PLOT_NOT_FOUND', 'Plot not found');

    const deleted = await tx
      .delete(plotSpecies)
      .where(and(eq(plotSpecies.plotId, plotId), eq(plotSpecies.speciesId, speciesId)))
      .returning({ speciesId: plotSpecies.speciesId });

    if (deleted.length === 0) {
      throw new AppError('SPECIES_NOT_FOUND', 'Species is not a member of this plot');
    }

    await recordAudit(tx, {
      actorUserId: actorId,
      action: 'plots.species_removed',
      targetType: 'plots',
      targetId: plotId,
      metadata: { speciesId },
    });
  });
}

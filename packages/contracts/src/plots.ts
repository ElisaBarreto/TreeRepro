import { z } from 'zod';
import { cursorQuerySchema } from './pagination.ts';
import { USER_STATUSES } from './user-status.ts';

const nonEmpty = <T extends z.ZodRawShape>(shape: T, first: keyof T & string) =>
  z.strictObject(shape).refine((b) => Object.keys(b).length > 0, {
    message: 'Nothing to change',
    path: [first],
  });

/** @rfc RFC-67 R1 */
export const plotCodeSchema = z.string().trim().min(1).max(64);

/**
 * Minimal plot identifier for references.
 * @rfc RFC-67 R1
 * @rfc RFC-67 R6
 */
export const plotRefSchema = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});

/**
 * Full field plot metadata.
 * @rfc RFC-67 R1
 * @rfc RFC-67 R3
 */
export const plotSchema = plotRefSchema.extend({
  description: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  country: z.string().nullable(),
  biome: z.string().nullable(),
  speciesCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * Detailed plot response including userCount for plots.manage holders.
 * @rfc RFC-67 R3
 */
export const plotDetailSchema = plotSchema.extend({
  userCount: z.number().int().nonnegative().nullable(),
});

/**
 * Query schema for listing plots.
 * @rfc RFC-67 R3
 */
export const listPlotsQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
});

/**
 * Query schema for listing species within a plot.
 * @rfc RFC-67 R4
 * @rfc RFC-60 R6
 */
export const listPlotSpeciesQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().min(2).max(100).optional(),
});

/**
 * Body schema for creating a field plot.
 * @rfc RFC-67 R5
 */
export const createPlotBodySchema = z.strictObject({
  code: plotCodeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  biome: z.string().trim().min(1).max(100).optional(),
});

/**
 * Body schema for updating a field plot.
 * @rfc RFC-67 R5
 */
export const updatePlotBodySchema = nonEmpty(
  {
    code: plotCodeSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    country: z.string().trim().min(1).max(100).nullable().optional(),
    biome: z.string().trim().min(1).max(100).nullable().optional(),
  },
  'code',
);

/**
 * Body schema for adding a species to a plot.
 * @rfc RFC-67 R5
 */
export const plotSpeciesBodySchema = z.strictObject({
  speciesId: z.uuid(),
});

/**
 * Route params for plot species operations.
 * @rfc RFC-67 R5
 */
export const plotSpeciesMemberParamSchema = z.strictObject({
  id: z.uuid(),
  speciesId: z.uuid(),
});

/**
 * User membership representation on a field plot. No e-mail address: the
 * address is `users.read` data wherever it appears.
 * @rfc RFC-67 R4
 * @rfc RFC-02 R14
 */
export const plotUserSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(USER_STATUSES),
  restricted: z.boolean(),
});

/**
 * Allowed scopes for species listing.
 * @rfc RFC-33 R6
 * @rfc RFC-67 R8
 */
export const SPECIES_SCOPES = ['plots', 'all'] as const;
export type SpeciesScope = (typeof SPECIES_SCOPES)[number];

export type PlotRef = z.infer<typeof plotRefSchema>;
export type Plot = z.infer<typeof plotSchema>;
export type PlotDetail = z.infer<typeof plotDetailSchema>;
export type ListPlotsQuery = z.infer<typeof listPlotsQuerySchema>;
export type ListPlotSpeciesQuery = z.infer<typeof listPlotSpeciesQuerySchema>;
export type CreatePlotBody = z.infer<typeof createPlotBodySchema>;
export type UpdatePlotBody = z.infer<typeof updatePlotBodySchema>;
export type PlotSpeciesBody = z.infer<typeof plotSpeciesBodySchema>;
export type PlotUser = z.infer<typeof plotUserSchema>;

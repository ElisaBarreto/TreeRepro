import { z } from 'zod';
import { contributionSummarySchema } from './contributions.ts';
import { recordSchema, traitRefSchema } from './dataset.ts';
import { plotRefSchema } from './plots.ts';

/** @rfc RFC-72 R1 */
export const dashboardSchema = z.strictObject({
  dataset: z.strictObject({
    speciesCount: z.number().int().nonnegative(),
    referenceCount: z.number().int().nonnegative(),
    primaryReferenceCount: z.number().int().nonnegative(),
    secondaryReferenceCount: z.number().int().nonnegative(),
    recordCount: z.number().int().nonnegative(),
    computedAt: z.iso.datetime(),
  }),
  scope: z
    .strictObject({
      plots: z.array(plotRefSchema.extend({ speciesCount: z.number().int().nonnegative() })),
      speciesCount: z.number().int().nonnegative(),
      restricted: z.boolean(),
    })
    .nullable(),
  contributor: z.strictObject({
    missingCells: z.number().int().nonnegative().nullable(),
    awaitingValidation: z
      .strictObject({
        count: z.number().int().nonnegative(),
        records: z.array(recordSchema),
      })
      .nullable(),
    topTraitsWithData: z.array(
      z.strictObject({
        trait: traitRefSchema,
        category: z.strictObject({ key: z.string(), label: z.string() }),
        speciesCount: z.number().int().nonnegative(),
      }),
    ),
    summary: contributionSummarySchema,
  }),
  curation: z
    .strictObject({
      coverage: z.strictObject({
        cells: z.number().int().nonnegative(),
        withData: z.number().int().nonnegative(),
        validated: z.number().int().nonnegative(),
        percentWithData: z.number().int().nonnegative(),
        percentValidated: z.number().int().nonnegative(),
      }),
      queues: z.strictObject({
        pendingGroups: z.number().int().nonnegative(),
        disputed: z.number().int().nonnegative(),
        contested: z.number().int().nonnegative(),
        proposals: z.number().int().nonnegative(),
      }),
    })
    .nullable(),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

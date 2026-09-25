import { z } from 'zod';

const titleSchema = z.string().trim().min(1).max(200);
const sectionTitleSchema = z.string().trim().max(200);
const summarySchema = z.string().trim().max(500);
const bodyHtmlSchema = z.string().max(100_000);
const positionSchema = z.number().int().min(0);

const nonEmpty = <T extends z.ZodRawShape>(shape: T, first: keyof T & string) =>
  z.strictObject(shape).refine((b) => Object.keys(b).length > 0, {
    message: 'Nothing to change',
    path: [first],
  });

/** One topic as the help index lists it. @rfc RFC-73 R6 */
export const helpTopicSummarySchema = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
});
export type HelpTopicSummary = z.infer<typeof helpTopicSummarySchema>;

/** One section of a topic; `anchor` is null for an untitled section. @rfc RFC-73 R2, R6 */
export const helpSectionSchema = z.strictObject({
  id: z.uuid(),
  anchor: z.string().nullable(),
  title: z.string(),
  bodyHtml: z.string(),
});
export type HelpSection = z.infer<typeof helpSectionSchema>;

/** A topic with its sections in order. @rfc RFC-73 R6 */
export const helpTopicSchema = helpTopicSummarySchema.extend({
  sections: z.array(helpSectionSchema),
});
export type HelpTopic = z.infer<typeof helpTopicSchema>;

/** `POST /api/help`. @rfc RFC-73 R6 */
export const createHelpTopicBodySchema = z.strictObject({
  title: titleSchema,
  summary: summarySchema.optional(),
});
export type CreateHelpTopicBody = z.infer<typeof createHelpTopicBodySchema>;

/** `PATCH /api/help/:id`. @rfc RFC-73 R6 */
export const updateHelpTopicBodySchema = nonEmpty(
  {
    title: titleSchema.optional(),
    summary: summarySchema.optional(),
    position: positionSchema.optional(),
  },
  'title',
);
export type UpdateHelpTopicBody = z.infer<typeof updateHelpTopicBodySchema>;

/** `POST /api/help/:id/sections`. @rfc RFC-73 R6 */
export const createHelpSectionBodySchema = z.strictObject({
  title: sectionTitleSchema.optional(),
  bodyHtml: bodyHtmlSchema.optional(),
});
export type CreateHelpSectionBody = z.infer<typeof createHelpSectionBodySchema>;

/** `PATCH /api/help/sections/:id`. @rfc RFC-73 R6 */
export const updateHelpSectionBodySchema = nonEmpty(
  {
    title: sectionTitleSchema.optional(),
    bodyHtml: bodyHtmlSchema.optional(),
    position: positionSchema.optional(),
  },
  'title',
);
export type UpdateHelpSectionBody = z.infer<typeof updateHelpSectionBodySchema>;

/** `GET /api/help/:slug`. @rfc RFC-73 R6 */
export const helpSlugParamSchema = z.strictObject({ slug: z.string().min(1).max(200) });

import { z } from 'zod';
import { catalogNameSchema, curationNoteSchema, speciesNameBodySchema } from './curation.ts';
import { NAME_SOURCES, userRefSchema } from './dataset.ts';
import { cursorQuerySchema } from './pagination.ts';

/**
 * The `species_proposals.status` values the table CHECK constraint allows.
 * @rfc RFC-75 R1
 */
export const PROPOSAL_STATUSES = ['open', 'approved', 'rejected'] as const;

/** The verdicts a taxonomy lookup (RFC-81) can produce. @rfc RFC-81 R3 */
export const LOOKUP_VERDICTS = ['exact', 'fuzzy', 'none', 'failed'] as const;

/**
 * One GBIF backbone or WCVP answer, mapped into a shared shape. `usageKey`
 * and `acceptedUsageKey` are strings: the live v2 backbone returns
 * `usage.key` as a JSON string already (and a checklist source can return a
 * non-numeric key such as `"4R5YN"`); the WCVP v1 mapper stringifies its
 * numeric `key`/`acceptedKey` to match.
 * @rfc RFC-81 R2
 */
export const taxonMatchSchema = z.strictObject({
  matchType: z.enum(['EXACT', 'VARIANT', 'FUZZY', 'HIGHERRANK', 'NONE']),
  confidence: z.number().int().nullable(),
  usageKey: z.string().nullable(),
  scientificName: z.string().nullable(),
  canonicalName: z.string().nullable(),
  rank: z.string().nullable(),
  status: z.string().nullable(),
  family: z.string().nullable(),
  genus: z.string().nullable(),
  acceptedUsageKey: z.string().nullable(),
  note: z.string().nullable(),
});

/**
 * The `lookup` jsonb stored on a proposal: up to two source matches and the
 * verdict computed over however many sources were attempted.
 * @rfc RFC-81 R3
 */
export const lookupSchema = z.strictObject({
  backbone: taxonMatchSchema.nullable(),
  wcvp: taxonMatchSchema.nullable(),
  verdict: z.enum(LOOKUP_VERDICTS),
});

/** A species proposal, as returned to a caller. @rfc RFC-75 R6 */
export const proposalSchema = z.strictObject({
  id: z.uuid(),
  proposedName: z.string(),
  note: z.string().nullable(),
  status: z.enum(PROPOSAL_STATUSES),
  proposer: userRefSchema,
  lookup: lookupSchema.nullable(),
  lookupAt: z.iso.datetime().nullable(),
  species: z.strictObject({ id: z.uuid(), canonicalName: z.string() }).nullable(),
  decidedBy: userRefSchema.nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** `POST /api/species/proposals` body. @rfc RFC-75 R2 */
export const createProposalBodySchema = z.strictObject({
  name: z.string().trim().min(3).max(200),
  note: curationNoteSchema.optional(),
});

/** `GET /api/species/proposals` query. @rfc RFC-75 R3 */
export const listProposalsQuerySchema = cursorQuerySchema.extend({
  status: z.enum(PROPOSAL_STATUSES).optional(),
});

/** `POST /api/species/proposals/:id/approve` body. @rfc RFC-75 R4 */
export const approveProposalBodySchema = z.strictObject({
  canonicalName: catalogNameSchema,
  nameSource: z.enum(NAME_SOURCES),
  genusName: catalogNameSchema.optional(),
  familyName: catalogNameSchema.optional(),
  alternativeNames: z.array(speciesNameBodySchema).max(20).optional(),
});

/** `POST /api/species/proposals/:id/reject` body. @rfc RFC-75 R4 */
export const rejectProposalBodySchema = z.strictObject({ note: curationNoteSchema });

/** `GET /api/taxonomy/match` query. @rfc RFC-81 R4 */
export const taxonomyMatchQuerySchema = z.strictObject({
  name: z.string().trim().min(3).max(200),
});

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type LookupVerdict = (typeof LOOKUP_VERDICTS)[number];
export type TaxonMatch = z.infer<typeof taxonMatchSchema>;
export type Lookup = z.infer<typeof lookupSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type CreateProposalBody = z.infer<typeof createProposalBodySchema>;
export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;
export type ApproveProposalBody = z.infer<typeof approveProposalBodySchema>;
export type RejectProposalBody = z.infer<typeof rejectProposalBodySchema>;
export type TaxonomyMatchQuery = z.infer<typeof taxonomyMatchQuerySchema>;

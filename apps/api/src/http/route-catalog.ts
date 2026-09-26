import {
  apiKeyListSchema,
  auditLogEntrySchema,
  batchResponseSchema,
  contestedQueueItemSchema,
  contributionAnnotationSchema,
  contributionRecordSchema,
  contributionSummarySchema,
  coverageSchema,
  coverageTraitRowSchema,
  createApiKeyResponseSchema,
  createRecordsResultSchema,
  dashboardSchema,
  dataEnvelopeSchema,
  dictionarySchema,
  forgotPasswordResponseSchema,
  genusSchema,
  healthResponseSchema,
  helpSectionSchema,
  helpTopicSchema,
  helpTopicSummarySchema,
  importBatchSchema,
  importRejectSchema,
  inviteAcceptResponseSchema,
  listEnvelopeSchema,
  loginResponseSchema,
  lookupSchema,
  mapResultSchema,
  mapsResponseSchema,
  meResponseSchema,
  okStatusSchema,
  pendingGroupSchema,
  pendingTraitSchema,
  permissionEntrySchema,
  platformHealthSchema,
  plotDetailSchema,
  plotSchema,
  plotUserSchema,
  proposalSchema,
  recordDetailSchema,
  recordSchema,
  referenceDetailSchema,
  referenceSchema,
  resolveDoiResultSchema,
  roleSchema,
  sessionSummarySchema,
  signedInSchema,
  speciesListItemSchema,
  speciesSchema,
  speciesTraitsSchema,
  taxonRefSchema,
  totpConfirmResponseSchema,
  totpSetupResponseSchema,
  traitDetailSchema,
  traitSchema,
  traitSpeciesItemSchema,
  userSchema,
  validateLevelResultSchema,
  withdrawLevelResultSchema,
} from '@treerepro/contracts';
import { z } from 'zod';

/**
 * One catalog entry: a one-line summary for an external caller (a script,
 * not a browser) and, when a `packages/contracts` schema describes the route's
 * JSON body exactly as sent, its response schema. `response` is left out
 * wherever no contract schema fits the actual `c.json(...)` call precisely —
 * a wrong schema is worse than a missing one (Task 4 wraps it as the OpenAPI
 * `2XX` schema with `z.toJSONSchema`).
 * @rfc RFC-82 R16
 */
export interface CatalogEntry {
  /** One line, imperative or noun phrase, ≤ 100 characters, no trailing period. */
  summary: string;
  /** Schema of the full JSON response body as sent (envelope included), when packages/contracts has one. */
  response?: z.ZodType;
}

/**
 * One entry per route mounted on the API, in the order
 * `routes-guarded.integration.test.ts` lists them. Every mounted route is
 * catalogued and every catalogued route is mounted (its own meta-test),
 * `GET /api/docs` and `GET /api/docs/openapi.json` (RFC-82 R20) included.
 * @rfc RFC-82 R16
 */
export const ROUTE_CATALOG: Readonly<Record<string, CatalogEntry>> = {
  // health
  'GET /api/health': {
    summary: 'Report that the API process is running',
    response: healthResponseSchema,
  },
  'GET /api/health/ready': {
    summary: 'Report whether the database and Redis are reachable',
    response: healthResponseSchema,
  },

  // auth
  'POST /api/auth/login': {
    summary: 'Sign in with email and password',
    response: dataEnvelopeSchema(loginResponseSchema),
  },
  'POST /api/auth/login/totp': {
    summary: 'Complete sign-in with a TOTP or recovery code',
    response: dataEnvelopeSchema(signedInSchema),
  },
  'POST /api/auth/invite/accept': {
    summary: 'Accept an invitation, set a password and sign in',
    response: dataEnvelopeSchema(inviteAcceptResponseSchema),
  },
  'POST /api/auth/password/forgot': {
    summary: 'Request a password reset email',
    response: dataEnvelopeSchema(forgotPasswordResponseSchema),
  },
  'POST /api/auth/password/reset': {
    summary: 'Reset a password with a reset token',
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'POST /api/auth/logout': {
    summary: 'Sign out the current session',
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'POST /api/auth/logout-all': {
    summary: "Sign out every one of the caller's sessions",
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'GET /api/auth/me': {
    summary: 'Get the signed-in user, their permissions and their scope',
    response: dataEnvelopeSchema(meResponseSchema),
  },
  'POST /api/auth/password/change': {
    summary: "Change the caller's own password",
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'POST /api/auth/totp/setup': {
    summary: 'Start TOTP setup and get a secret to enrol',
    response: dataEnvelopeSchema(totpSetupResponseSchema),
  },
  'POST /api/auth/totp/confirm': {
    summary: 'Confirm TOTP setup and get one-time recovery codes',
    response: dataEnvelopeSchema(totpConfirmResponseSchema),
  },
  'POST /api/auth/totp/disable': {
    summary: "Disable the caller's TOTP",
    response: dataEnvelopeSchema(okStatusSchema),
  },

  // me
  'GET /api/me/sessions': {
    summary: "List the caller's own sessions",
    response: dataEnvelopeSchema(z.array(sessionSummarySchema)),
  },
  'DELETE /api/me/sessions/:id': {
    summary: 'Revoke one of the caller’s own sessions',
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'GET /api/me/api-keys': {
    summary: "List the caller's own API keys",
    response: dataEnvelopeSchema(apiKeyListSchema),
  },
  'POST /api/me/api-keys': {
    summary: 'Create an API key for the caller',
    response: dataEnvelopeSchema(createApiKeyResponseSchema),
  },
  'DELETE /api/me/api-keys/:id': {
    summary: "Revoke one of the caller's own API keys",
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'PATCH /api/me': {
    summary: "Update the caller's own display name",
    response: dataEnvelopeSchema(userSchema),
  },
  'GET /api/me/contributions': {
    summary: "List the caller's own records or annotations",
    response: listEnvelopeSchema(z.union([contributionRecordSchema, contributionAnnotationSchema])),
  },
  'GET /api/me/contributions/summary': {
    summary: "Summarise the caller's own contributions",
    response: dataEnvelopeSchema(contributionSummarySchema),
  },
  'GET /api/me/proposals': {
    summary: "List the caller's own species proposals",
    response: listEnvelopeSchema(proposalSchema),
  },
  'GET /api/me/dashboard': {
    summary: "Get the caller's workspace dashboard",
    response: dataEnvelopeSchema(dashboardSchema),
  },
  'GET /api/coverage': {
    summary: 'Get the species × trait coverage grid, filtered',
    response: dataEnvelopeSchema(coverageSchema),
  },
  'GET /api/coverage/top': {
    summary: 'List the traits with the most missing or least validated data',
    response: dataEnvelopeSchema(z.array(coverageTraitRowSchema)),
  },

  // help
  'GET /api/help': {
    summary: 'List help topics',
    response: dataEnvelopeSchema(z.array(helpTopicSummarySchema)),
  },
  'GET /api/help/:slug': {
    summary: 'Get a help topic with its sections',
    response: dataEnvelopeSchema(helpTopicSchema),
  },
  'POST /api/help': {
    summary: 'Create a help topic',
    response: dataEnvelopeSchema(helpTopicSchema),
  },
  'PATCH /api/help/:id': {
    summary: 'Update a help topic',
    response: dataEnvelopeSchema(helpTopicSchema),
  },
  'DELETE /api/help/:id': {
    summary: 'Delete a help topic',
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'POST /api/help/:id/sections': {
    summary: 'Add a section to a help topic',
    response: dataEnvelopeSchema(helpSectionSchema),
  },
  'PATCH /api/help/sections/:id': {
    summary: 'Update a help section',
    response: dataEnvelopeSchema(helpSectionSchema),
  },
  'DELETE /api/help/sections/:id': {
    summary: 'Delete a help section',
    response: dataEnvelopeSchema(okStatusSchema),
  },

  // admin
  'GET /api/admin/permissions': {
    summary: 'List the permission catalog',
    response: dataEnvelopeSchema(z.array(permissionEntrySchema)),
  },
  'GET /api/admin/users': { summary: 'List users', response: listEnvelopeSchema(userSchema) },
  'POST /api/admin/users': { summary: 'Invite a user', response: dataEnvelopeSchema(userSchema) },
  'GET /api/admin/users/:id': { summary: 'Get a user', response: dataEnvelopeSchema(userSchema) },
  'PATCH /api/admin/users/:id': {
    summary: "Update a user's name or roles",
    response: dataEnvelopeSchema(userSchema),
  },
  'PUT /api/admin/users/:id/plots': {
    summary: "Set a user's assigned field plots and plot restriction",
    response: dataEnvelopeSchema(userSchema),
  },
  'POST /api/admin/users/:id/suspend': {
    summary: 'Suspend a user',
    response: dataEnvelopeSchema(userSchema),
  },
  'POST /api/admin/users/:id/reactivate': {
    summary: 'Reactivate a suspended user',
    response: dataEnvelopeSchema(userSchema),
  },
  'POST /api/admin/users/:id/resend-invite': {
    summary: 'Resend an invited user’s invitation email',
    response: dataEnvelopeSchema(userSchema),
  },
  'GET /api/admin/users/:id/sessions': {
    summary: "List a user's sessions",
    response: dataEnvelopeSchema(z.array(sessionSummarySchema)),
  },
  'DELETE /api/admin/users/:id/sessions': {
    summary: 'Revoke every session of a user',
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'DELETE /api/admin/users/:id/sessions/:sessionId': {
    summary: 'Revoke one session of a user',
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'GET /api/admin/users/:id/contributions': {
    summary: "List a user's own records or annotations",
    response: listEnvelopeSchema(z.union([contributionRecordSchema, contributionAnnotationSchema])),
  },
  'GET /api/admin/users/:id/contributions/summary': {
    summary: "Summarise a user's contributions",
    response: dataEnvelopeSchema(contributionSummarySchema),
  },
  'GET /api/admin/roles': {
    summary: 'List roles',
    response: dataEnvelopeSchema(z.array(roleSchema)),
  },
  'POST /api/admin/roles': { summary: 'Create a role', response: dataEnvelopeSchema(roleSchema) },
  'GET /api/admin/roles/:id': { summary: 'Get a role', response: dataEnvelopeSchema(roleSchema) },
  'PATCH /api/admin/roles/:id': {
    summary: "Update a role's name, description or permissions",
    response: dataEnvelopeSchema(roleSchema),
  },
  'DELETE /api/admin/roles/:id': {
    summary: 'Delete a role',
    response: dataEnvelopeSchema(okStatusSchema),
  },
  'GET /api/admin/audit': {
    summary: 'Search the audit log',
    response: listEnvelopeSchema(auditLogEntrySchema),
  },
  'GET /api/admin/health': {
    summary: 'Get a platform-wide health snapshot',
    response: dataEnvelopeSchema(platformHealthSchema),
  },

  // species
  'GET /api/species': {
    summary: 'Search species with taxonomy, trait and scope filters',
    response: listEnvelopeSchema(speciesListItemSchema),
  },
  'POST /api/species': { summary: 'Create a species', response: dataEnvelopeSchema(speciesSchema) },
  'POST /api/species/proposals': {
    summary: 'Propose a new species for the catalog',
    response: dataEnvelopeSchema(proposalSchema),
  },
  'GET /api/species/proposals': {
    summary: 'List species proposals',
    response: listEnvelopeSchema(proposalSchema),
  },
  'GET /api/species/proposals/:id': {
    summary: 'Get a species proposal',
    response: dataEnvelopeSchema(proposalSchema),
  },
  'POST /api/species/proposals/:id/approve': {
    summary: 'Approve a species proposal into a new or existing species',
    response: dataEnvelopeSchema(proposalSchema),
  },
  'POST /api/species/proposals/:id/reject': {
    summary: 'Reject a species proposal',
    response: dataEnvelopeSchema(proposalSchema),
  },
  'GET /api/taxonomy/match': {
    summary: 'Look up a name against GBIF and WCVP',
    response: dataEnvelopeSchema(lookupSchema),
  },
  'GET /api/species/:id': {
    summary: 'Get a species by id',
    response: dataEnvelopeSchema(speciesSchema),
  },
  'PATCH /api/species/:id': {
    summary: 'Update a species',
    response: dataEnvelopeSchema(speciesSchema),
  },
  'GET /api/species/:id/traits': {
    summary: "Get a species' trait summaries by category",
    response: dataEnvelopeSchema(speciesTraitsSchema),
  },
  'POST /api/species/:id/names': {
    summary: 'Add an alternative name to a species',
    response: dataEnvelopeSchema(speciesSchema),
  },
  'POST /api/species/:id/traits/:traitId/levels/:levelId/validate': {
    summary: "Validate every visible record of a species' trait level",
    response: dataEnvelopeSchema(validateLevelResultSchema),
  },
  'POST /api/species/:id/traits/:traitId/levels/:levelId/withdraw': {
    summary: 'Withdraw every removable record of a trait level',
    response: dataEnvelopeSchema(withdrawLevelResultSchema),
  },
  'POST /api/contests/:id/resolve': {
    summary: 'Keep both sides of a standing contest',
    response: dataEnvelopeSchema(z.null()),
  },
  'POST /api/contests/:id/withdraw': {
    summary: 'Withdraw a standing contest',
    response: dataEnvelopeSchema(z.null()),
  },

  // taxa
  'GET /api/families': { summary: 'List families', response: listEnvelopeSchema(taxonRefSchema) },
  'POST /api/families': {
    summary: 'Create a family',
    response: dataEnvelopeSchema(taxonRefSchema),
  },
  'PATCH /api/families/:id': {
    summary: 'Rename a family',
    response: dataEnvelopeSchema(taxonRefSchema),
  },
  'GET /api/genera': { summary: 'List genera', response: listEnvelopeSchema(genusSchema) },
  'POST /api/genera': { summary: 'Create a genus', response: dataEnvelopeSchema(genusSchema) },
  'PATCH /api/genera/:id': {
    summary: 'Rename or move a genus to another family',
    response: dataEnvelopeSchema(genusSchema),
  },

  // references
  'GET /api/references': {
    summary: 'Search bibliographic references',
    response: listEnvelopeSchema(referenceSchema),
  },
  'GET /api/references/resolve': {
    summary: 'Resolve a DOI to a known reference or a preview',
    response: dataEnvelopeSchema(resolveDoiResultSchema),
  },
  'POST /api/references': {
    summary: 'Create a reference',
    response: dataEnvelopeSchema(referenceDetailSchema),
  },
  'GET /api/references/:id': {
    summary: 'Get a reference with its per-trait usage',
    response: dataEnvelopeSchema(referenceDetailSchema),
  },
  'PATCH /api/references/:id': {
    summary: 'Update a reference',
    response: dataEnvelopeSchema(referenceDetailSchema),
  },

  // records and curation
  'GET /api/records': {
    summary: 'List records for a species and trait, or for a reference',
    response: listEnvelopeSchema(recordSchema),
  },
  'GET /api/records/:id': {
    summary: "Get a record's full detail",
    response: dataEnvelopeSchema(recordDetailSchema),
  },
  'POST /api/records': {
    summary: 'Create trait records, a contest or a complement',
    response: dataEnvelopeSchema(createRecordsResultSchema),
  },
  'GET /api/records/pending/traits': {
    summary: 'List traits with pending values and their counts',
    response: dataEnvelopeSchema(z.array(pendingTraitSchema)),
  },
  'GET /api/records/pending': {
    summary: 'List pending groups of one type and trait',
    response: listEnvelopeSchema(pendingGroupSchema),
  },
  'POST /api/records/pending/map': {
    summary: 'Harmonise a pending value group into levels or a number',
    response: dataEnvelopeSchema(mapResultSchema),
  },
  'GET /api/records/disputed': {
    summary: 'List the standing contests',
    response: listEnvelopeSchema(contestedQueueItemSchema),
  },
  'POST /api/records/:id/annotations': {
    summary: 'Confirm or withdraw a record',
    response: dataEnvelopeSchema(recordDetailSchema.nullable()),
  },

  // traits
  'GET /api/traits': {
    summary: 'List the trait dictionary by category',
    response: dataEnvelopeSchema(dictionarySchema),
  },
  'POST /api/traits': { summary: 'Create a trait', response: dataEnvelopeSchema(traitSchema) },
  'GET /api/traits/:id': {
    summary: 'Get a trait with its category and value distribution',
    response: dataEnvelopeSchema(traitDetailSchema),
  },
  'GET /api/traits/:id/species': {
    summary: 'List species with, or missing, a value on this trait',
    response: listEnvelopeSchema(traitSpeciesItemSchema),
  },
  'PATCH /api/traits/:id': { summary: 'Update a trait', response: dataEnvelopeSchema(traitSchema) },
  'POST /api/traits/:id/levels': {
    summary: 'Add a level to a categorical trait',
    response: dataEnvelopeSchema(traitSchema),
  },
  'PATCH /api/traits/:id/levels/:levelId': {
    summary: 'Rename, reorder or activate a trait level',
    response: dataEnvelopeSchema(traitSchema),
  },

  // imports
  'GET /api/imports': {
    summary: 'List import batches',
    response: listEnvelopeSchema(importBatchSchema),
  },
  'GET /api/imports/:id': {
    summary: 'Get an import batch',
    response: dataEnvelopeSchema(importBatchSchema),
  },
  'GET /api/imports/:id/rejects': {
    summary: "List an import batch's rejected rows",
    response: listEnvelopeSchema(importRejectSchema),
  },

  // export
  'GET /api/export/dataset.zip': { summary: 'Download the dataset as a ZIP file' },

  // maps
  'GET /api/maps': {
    summary: 'List the trait maps a viewer may see',
    response: dataEnvelopeSchema(mapsResponseSchema),
  },
  'GET /api/maps/files/:name': { summary: 'Download one trait map image file' },

  // plots
  'GET /api/plots': { summary: 'List field plots', response: listEnvelopeSchema(plotSchema) },
  'POST /api/plots': {
    summary: 'Create a field plot',
    response: dataEnvelopeSchema(plotDetailSchema),
  },
  'GET /api/plots/:id': {
    summary: 'Get a field plot',
    response: dataEnvelopeSchema(plotDetailSchema),
  },
  'PATCH /api/plots/:id': {
    summary: 'Update a field plot',
    response: dataEnvelopeSchema(plotDetailSchema),
  },
  'GET /api/plots/:id/species': {
    summary: "List a field plot's species",
    response: listEnvelopeSchema(speciesListItemSchema),
  },
  'GET /api/plots/:id/users': {
    summary: "List a field plot's assigned users",
    response: listEnvelopeSchema(plotUserSchema),
  },
  'POST /api/plots/:id/species': {
    summary: 'Add a species to a field plot',
    response: dataEnvelopeSchema(plotDetailSchema),
  },
  'DELETE /api/plots/:id/species/:speciesId': {
    summary: 'Remove a species from a field plot',
    response: dataEnvelopeSchema(plotDetailSchema),
  },

  // batch
  'POST /api/batch': {
    summary: 'Run up to 500 operations through the API in one request',
    response: dataEnvelopeSchema(batchResponseSchema),
  },

  // docs
  'GET /api/docs': { summary: 'Read this guide as Markdown' },
  'GET /api/docs/openapi.json': { summary: 'Read the generated OpenAPI 3.1 reference' },
};

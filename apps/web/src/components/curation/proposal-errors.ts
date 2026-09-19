import { ApiError } from '../../api/client.ts';
import { pageErrorMessage } from '../../lib/errors.ts';

/**
 * The species id `POST /api/species/proposals` puts in `details[0].message`
 * when it answers 409 `SPECIES_NAME_TAKEN` — the whole reason that detail
 * exists is so the dialog can link to the species instead of only naming it
 * (RFC-75 R2). A 409 from anywhere else, or one without the detail, answers
 * `null` and the caller says the same thing without a link.
 * @rfc RFC-75 R2
 */
export function takenSpeciesId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'SPECIES_NAME_TAKEN') return null;
  const id = error.details?.[0]?.message;
  return id === undefined || id === '' ? null : id;
}

/**
 * The sentence the propose dialog shows for a failure it has no control to
 * hang on. The two 409s of RFC-75 R2 are the ones a proposer meets in
 * practice: the name is already a species, or somebody has already proposed
 * it and the queue is waiting on a decision.
 * @rfc RFC-13 R6
 * @rfc RFC-75 R2
 */
export function proposeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SPECIES_NAME_TAKEN':
        return 'This species is already in the catalog.';
      case 'PROPOSAL_EXISTS':
        return 'Already proposed. It is in the queue, waiting for a decision.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

/**
 * The sentence a decision shows when it fails. `SPECIES_NAME_TAKEN` here is
 * not the proposer's 409: the pre-check of RFC-75 R2 is scoped to what the
 * proposer can see, while the unique index `createSpecies` hits at approval
 * is global (RFC-75 R4), so a plot-restricted contributor can have a name
 * accepted into the queue that a species outside their plots already holds.
 * The API cannot name that species — the answer carries no id, by design —
 * so the sentence says what happened and what to do instead of leaving the
 * reviewer with a bare conflict.
 * @rfc RFC-13 R6
 * @rfc RFC-75 R4
 */
export function decideErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SPECIES_NAME_TAKEN':
        return 'A species with this name is already in the catalog, outside what the proposer can see. Nothing was created and the proposal is still open: search the catalog for the name, then reject the proposal with a note pointing at it.';
      case 'PROPOSAL_DECIDED':
        return 'This proposal has already been decided. Reload the page.';
      case 'PROPOSAL_NOT_FOUND':
        return 'This proposal no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

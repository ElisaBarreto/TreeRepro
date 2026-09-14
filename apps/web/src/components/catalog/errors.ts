import { ApiError } from '../../api/client.ts';
import { fieldErrors, GENERIC_MESSAGE, pageErrorMessage } from '../../lib/errors.ts';

/**
 * The form-level sentences of the catalog writes (RFC-60 R9, RFC-61 R6,
 * RFC-62 R6), one helper per entity, shared by the dialogs that create and
 * edit it and by the pages that list it. A `*_TAKEN` conflict is the
 * caller's own sentence under the field it refers to; these cover what is
 * left — an entity the API can no longer find, `VALIDATION_FAILED` on a
 * field the form has no control for, and the generic fallback.
 * @rfc RFC-13 R6
 */
export function traitErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TRAIT_KEY_TAKEN':
        return 'A trait with this key already exists.';
      case 'TRAIT_NOT_FOUND':
        return 'This trait no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

/** @rfc RFC-13 R6 */
export function levelErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'LEVEL_KEY_TAKEN':
        return 'A level with this key already exists.';
      case 'LEVEL_NOT_FOUND':
      case 'TRAIT_NOT_FOUND':
        return 'This level no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

/**
 * The form-level sentence of a family or genus write. A `*_NAME_TAKEN`
 * answer is the caller's own sentence under the name field, and a
 * `VALIDATION_FAILED` detail lands under the field its `path` names; this
 * covers what is left.
 * @rfc RFC-13 R6
 */
export function taxonErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'FAMILY_NOT_FOUND' || error.code === 'GENUS_NOT_FOUND') {
      return 'The chosen taxon no longer exists. Reload the page.';
    }
    if (error.code === 'VALIDATION_FAILED') {
      return Object.values(fieldErrors(error))[0] ?? GENERIC_MESSAGE;
    }
  }
  return pageErrorMessage(error);
}

/** The sentence of a genus created inline from a species form that answers `GENUS_NAME_TAKEN`. @rfc RFC-13 R6 */
export function genusCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'GENUS_NAME_TAKEN') {
    return 'A genus with this name already exists.';
  }
  return taxonErrorMessage(error);
}

/** The sentence of a family created inline from a species form that answers `FAMILY_NAME_TAKEN`. @rfc RFC-13 R6 */
export function familyCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'FAMILY_NAME_TAKEN') {
    return 'A family with this name already exists.';
  }
  return taxonErrorMessage(error);
}

/** @rfc RFC-13 R6 */
export function speciesErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SPECIES_NAME_TAKEN':
        return 'A species with this name already exists.';
      case 'GENUS_NOT_FOUND':
      case 'FAMILY_NOT_FOUND':
        return 'The chosen taxon no longer exists. Reload the page.';
      case 'SPECIES_NOT_FOUND':
        return 'This species no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

export const REFERENCE_KEY_TAKEN_MESSAGE = 'A reference with this citation key already exists.';
export const REFERENCE_DOI_TAKEN_MESSAGE = 'Another reference has this DOI.';

/** @rfc RFC-13 R6 */
export function referenceErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'REFERENCE_KEY_TAKEN':
        return REFERENCE_KEY_TAKEN_MESSAGE;
      case 'REFERENCE_DOI_TAKEN':
        return REFERENCE_DOI_TAKEN_MESSAGE;
      case 'REFERENCE_NOT_FOUND':
        return 'This reference no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

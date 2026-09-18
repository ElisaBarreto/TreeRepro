import type { ReferenceKind } from '@treerepro/contracts';

/**
 * What {@link referenceLabel} needs of a reference: every shape the API
 * hands out carries the citation key and the kind (`referenceRefSchema` and
 * `referenceSchema` both require `kind`) and may carry `observer` — both
 * schemas carry the field, present whenever the reference has an observer
 * user, never conditioned on who is looking — and, for a reference that is
 * not one, the short citation a curator wrote or an import derived (RFC-61
 * R6, R8).
 */
export interface LabelledReference {
  citationKey: string;
  kind: ReferenceKind;
  observer?: { name: string } | null;
  shortCitation?: string | null;
}

/**
 * How a reference reads on screen. A personal observation's citation key is
 * `personal-observation:<user id>` (RFC-61 R7) — an internal identity a
 * contributor must never be shown — so it reads "Personal observation",
 * with the observer's name whenever the reference carries one (`observer`
 * is present iff the reference has an observer user — there is no
 * per-viewer check). Every other reference reads by its short citation when
 * one has been written or derived (RFC-61 R6, R8), else by its citation key.
 * @rfc RFC-61 R4, R7
 */
export function referenceLabel(reference: LabelledReference): string {
  if (reference.kind !== 'personal_observation') {
    return reference.shortCitation ?? reference.citationKey;
  }
  return reference.observer
    ? `Personal observation (${reference.observer.name})`
    : 'Personal observation';
}

/** Where a reference's DOI resolves (RFC-80 R4's registry link). @rfc RFC-61 R4 */
export function doiHref(doi: string): string {
  return `https://doi.org/${doi}`;
}

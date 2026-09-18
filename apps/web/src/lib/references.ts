import type { ReferenceKind } from '@treerepro/contracts';

/**
 * What {@link referenceLabel} needs of a reference: every shape the API
 * hands out carries the citation key, the kinds and the observer come with
 * the fuller ones (`ReferenceRef` has no observer, `Reference` has).
 */
export interface LabelledReference {
  citationKey: string;
  kind?: ReferenceKind;
  observer?: { name: string } | null;
}

/**
 * How a reference reads on screen. A personal observation's citation key is
 * `personal-observation:<user id>` (RFC-61 R7) — an internal identity a
 * contributor must never be shown — so it reads "Personal observation",
 * with the observer's name when the viewer may see it (the API leaves
 * `observer` out otherwise). Every other reference reads by its citation
 * key; plan 10d adds the short-citation branch here.
 * @rfc RFC-61 R4, R7
 */
export function referenceLabel(reference: LabelledReference): string {
  if (reference.kind !== 'personal_observation') return reference.citationKey;
  return reference.observer
    ? `Personal observation (${reference.observer.name})`
    : 'Personal observation';
}

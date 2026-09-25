import { formatNumber } from '../lib/format.ts';

/**
 * TreeRepro's public contact address (RFC-72 R3): the project's own inbox,
 * not a user's personal e-mail, so it is safe to show to every viewer.
 * Exported so the paragraph below and whatever renders it as a link agree
 * on the exact address without repeating it.
 * @rfc RFC-72 R3
 */
export const CONTACT_EMAIL = 'elisabpereira@gmail.com';

/**
 * The headline of the workspace home's intro card, and the page's h1
 * (RFC-72 R3). Beside the description so the owner edits both in one place.
 * @rfc RFC-72 R3
 */
export const PROJECT_HEADLINE = 'Help complete what we know about how trees reproduce.';

/**
 * The dataset counts {@link projectDescription} substitutes into the fixed
 * copy: the numbers `WorkspacePage` reads off `dashboard.dataset`
 * (RFC-72 R1).
 */
export interface ProjectCounts {
  primaryReferenceCount: number;
  secondaryReferenceCount: number;
  recordCount: number;
  speciesCount: number;
}

/**
 * The project's introduction, reproduced character for character from
 * RFC-72 R3 (spec R-18) with the dataset's live counts substituted in. The
 * copy lives here, on its own, so the project owner can edit it without
 * touching a component; the contact e-mail is rendered as a link by the
 * caller, not by this module, which carries only the words. The counts are
 * written with `formatNumber`'s thousands separators (RFC-13 R9).
 * @rfc RFC-72 R3
 * @rfc RFC-13 R9
 */
export function projectDescription(counts: ProjectCounts): string {
  return (
    'TreeRepro is a collective data assembly of reproductive trait data for trees, ' +
    'covering traits across all reproductive stages — flower, fruits, and seeds. ' +
    'Its core data comes from open-source papers and data repositories spanning ' +
    `${formatNumber(counts.primaryReferenceCount)} primary references, ` +
    `${formatNumber(counts.secondaryReferenceCount)} secondary references and ` +
    `${formatNumber(counts.recordCount)} records over ${formatNumber(counts.speciesCount)} species. ` +
    'It is shared here with a community of specialists to fill gaps and ' +
    'validate existing records. ' +
    `For questions, contact ${CONTACT_EMAIL}.`
  );
}

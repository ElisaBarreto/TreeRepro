import type { Lookup, NameSource, Proposal, TaxonMatch } from '@treerepro/contracts';

/** What the approval form opens with, derived from the stored lookup. @rfc RFC-75 R4 */
export interface ProposalPrefill {
  canonicalName: string;
  nameSource: NameSource;
  /** `''` when the lookup named none; the approve body leaves it out. */
  genusName: string;
  familyName: string;
}

/**
 * The ranks whose name is a name for the taxon that was proposed: species
 * and the infraspecific ranks below it. GBIF answers a subspecies or variety
 * at its own rank, and that name is the proposal's own name spelled the way
 * GBIF spells it — which is exactly what a prefill is for. A rank *above*
 * species is a different, broader taxon (`Quercus` for *Quercus robur*) and
 * is deliberately absent: its name must never become the canonical name.
 * @rfc RFC-81 R2
 */
const NAMEABLE_RANKS: ReadonlySet<string> = new Set([
  'SPECIES',
  'SUBSPECIES',
  'VARIETY',
  'SUBVARIETY',
  'FORM',
  'SUBFORM',
]);

// A source that answered and found nothing comes back as a real `TaxonMatch`
// with `matchType: 'NONE'` and every other field `null` — not as `null`,
// which is what a failed call looks like (RFC-81 R2, R3). It names nothing,
// so it can never be the source a form is filled from.
function answered(match: TaxonMatch | null): TaxonMatch | null {
  return match && match.matchType !== 'NONE' ? match : null;
}

/**
 * The source a reviewer is shown first, and the name source it would make.
 * WCVP wins only when it is itself an `EXACT` match at a rank that names the
 * taxon — which is what RFC-75's Web paragraph means by "when the WCVP match
 * is exact", and is not implied by the verdict: the verdict is `exact` as
 * soon as *either* source matched exactly, so a backbone hit paired with a
 * WCVP miss is still `exact`. Otherwise the backbone, and WCVP alone when
 * the backbone did not answer. `null` when neither source answered with a
 * match, including a lookup that never ran.
 * @rfc RFC-75 R4
 * @rfc RFC-81 R3
 */
export function preferredSource(
  lookup: Lookup | null,
): { match: TaxonMatch; source: NameSource } | null {
  if (!lookup) return null;
  const backbone = answered(lookup.backbone);
  const wcvp = answered(lookup.wcvp);
  if (wcvp && wcvp.matchType === 'EXACT' && namesTheTaxon(wcvp)) {
    return { match: wcvp, source: 'wcvp' };
  }
  if (backbone) return { match: backbone, source: 'gbif' };
  if (wcvp) return { match: wcvp, source: 'wcvp' };
  return null;
}

/** The match of {@link preferredSource} alone. @rfc RFC-81 R3 */
export function preferredMatch(lookup: Lookup | null): TaxonMatch | null {
  return preferredSource(lookup)?.match ?? null;
}

// Whether this match's own name is a name for the taxon proposed.
function namesTheTaxon(match: TaxonMatch): boolean {
  return match.rank !== null && NAMEABLE_RANKS.has(match.rank);
}

/**
 * The species form an approval opens with (RFC-75 R4): the canonical name
 * comes from the WCVP match when that match is exact, else from the GBIF
 * backbone, else from the proposed name, and `nameSource` says which of the
 * three it was — which is what is stored on the species, so a source named
 * here that did not supply the name would be false provenance.
 *
 * A name is taken from a source **only when that source matched at a rank
 * that names the taxon** (`NAMEABLE_RANKS`) — the same kind of rule RFC-81
 * R3 applies to the verdict, and for the same reason: `Quercus` matches
 * `EXACT` at `rank: GENUS`, and prefilling "Quercus" as the canonical name
 * of a proposal for *Quercus robur* would silently create the wrong taxon.
 * The genus and family are taken from the match either way, because a
 * genus-rank match still names them correctly.
 *
 * Nothing here is a rule the API does not own: the reviewer sees and edits
 * every field before it is sent (RFC-13 R1).
 * @rfc RFC-75 R4
 * @rfc RFC-81 R3
 */
export function proposalPrefill(proposal: Proposal): ProposalPrefill {
  const best = preferredSource(proposal.lookup);
  const named =
    best && namesTheTaxon(best.match) && best.match.canonicalName
      ? { canonicalName: best.match.canonicalName, nameSource: best.source }
      : { canonicalName: proposal.proposedName, nameSource: 'original' as NameSource };
  return {
    ...named,
    genusName: best?.match.genus ?? '',
    familyName: best?.match.family ?? '',
  };
}

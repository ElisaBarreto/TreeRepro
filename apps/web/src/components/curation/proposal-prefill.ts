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
 * The source a reviewer is shown first, and the name source it would make:
 * WCVP when the API's verdict is `exact` and WCVP is a source that answered,
 * otherwise the GBIF backbone, and WCVP alone when the backbone did not
 * answer at all. `null` when neither did, including a lookup that never ran.
 * @rfc RFC-81 R3
 */
export function preferredSource(
  lookup: Lookup | null,
): { match: TaxonMatch; source: NameSource } | null {
  if (!lookup) return null;
  if (lookup.verdict === 'exact' && lookup.wcvp) return { match: lookup.wcvp, source: 'wcvp' };
  if (lookup.backbone) return { match: lookup.backbone, source: 'gbif' };
  if (lookup.wcvp) return { match: lookup.wcvp, source: 'wcvp' };
  return null;
}

/** The match of {@link preferredSource} alone. @rfc RFC-81 R3 */
export function preferredMatch(lookup: Lookup | null): TaxonMatch | null {
  return preferredSource(lookup)?.match ?? null;
}

/**
 * The species form an approval opens with (RFC-75 R4): the canonical name
 * comes from the WCVP match when the verdict is `exact`, else from the
 * backbone, else from the proposed name, and `nameSource` says which of the
 * three it was.
 *
 * A name is taken from a source **only when that source matched at species
 * rank** — the same rule RFC-81 R3 applies to the verdict, and for the same
 * reason: `Quercus` matches `EXACT` at `rank: GENUS`, and prefilling
 * "Quercus" as the canonical name of a proposal for *Quercus robur* would
 * silently create the wrong taxon. The genus and family are taken from the
 * match either way, because a genus-rank match still names them correctly.
 * Nothing here is a rule the API does not own: the reviewer sees and edits
 * every field before it is sent (RFC-13 R1).
 * @rfc RFC-75 R4
 * @rfc RFC-81 R3
 */
export function proposalPrefill(proposal: Proposal): ProposalPrefill {
  const best = preferredSource(proposal.lookup);
  const named =
    best && best.match.rank === 'SPECIES' && best.match.canonicalName
      ? { canonicalName: best.match.canonicalName, nameSource: best.source }
      : { canonicalName: proposal.proposedName, nameSource: 'original' as NameSource };
  return {
    ...named,
    genusName: best?.match.genus ?? '',
    familyName: best?.match.family ?? '',
  };
}

import type { Lookup, LookupVerdict, TaxonMatch } from '@treerepro/contracts';
import { Badge } from '../ui/index.ts';

/**
 * How each verdict of RFC-81 R3 reads. `none` and `failed` are different
 * facts and must never share a word: `none` means GBIF answered and did not
 * know the name — a statement about the name — while `failed` means the call
 * did not complete, which says nothing about the name at all.
 * @rfc RFC-81 R3
 */
const VERDICT_LABELS: Record<LookupVerdict, string> = {
  exact: 'exact match',
  fuzzy: 'fuzzy',
  none: 'not found',
  failed: 'lookup failed',
};

const VERDICT_TONES: Record<LookupVerdict, 'green' | 'amber' | 'neutral' | 'red'> = {
  exact: 'green',
  fuzzy: 'amber',
  none: 'neutral',
  failed: 'red',
};

/**
 * The verdict the API computed, rendered as it stands. It is never derived
 * again here from `matchType`: `exact` requires a match at species rank
 * (RFC-81 R3), so an `EXACT` answer for a genus name is not an exact match,
 * and a lookup stored as `null` is the `failed` case — the call did not
 * complete — not a name GBIF could not find.
 * @rfc RFC-13 R5
 * @rfc RFC-81 R3
 */
export function LookupBadge({ lookup }: { lookup: Lookup | null }) {
  const verdict: LookupVerdict = lookup?.verdict ?? 'failed';
  return <Badge tone={VERDICT_TONES[verdict]}>{VERDICT_LABELS[verdict]}</Badge>;
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-label font-bold uppercase tracking-[0.08em] text-mist-500">{label}</dt>
      <dd className="text-cell text-canopy-950">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * One source's answer (RFC-81 R2): the scientific name, the rank, the
 * taxonomic status, the family and genus, the confidence — `—` for WCVP,
 * which reports none — and a link to the taxon's GBIF page. The link form is
 * `https://www.gbif.org/species/<usageKey>` for either source, with no
 * checklist suffix, and opens in a new tab with `rel="noopener noreferrer"`
 * so leaving the queue cannot reach back into it.
 *
 * Only a real match draws a card. The two ways of having none are the same
 * pair this whole branch keeps apart (RFC-81 R3), and each gets its own
 * sentence: `null` is a call that did not complete, and a `matchType` of
 * `NONE` is a source that answered and has no row for the name — which
 * arrives as a `TaxonMatch` with every other field `null` and would
 * otherwise draw a card of dashes, reading like a match with nothing in it.
 * @rfc RFC-13 R5
 * @rfc RFC-81 R2, R3
 */
export function LookupCard({ source, match }: { source: string; match: TaxonMatch | null }) {
  if (!match) {
    return (
      <p className="text-body text-mist-500">{`${source} did not answer: the call to it failed.`}</p>
    );
  }
  if (match.matchType === 'NONE') {
    return (
      <p className="text-body text-mist-500">{`${source} answered and has no record of this name.`}</p>
    );
  }
  return (
    // A named `section` is a region: the drawer's two cards are the parts of
    // it a reader compares, and naming them is what lets a screen reader jump
    // between the two answers.
    <section
      aria-label={source}
      className="flex flex-col gap-2 rounded-xl border border-canopy-700/15 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-card font-semibold text-canopy-950">{source}</h4>
        {match.usageKey === null ? null : (
          <a
            href={`https://www.gbif.org/species/${match.usageKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-meta font-semibold text-canopy-800 underline"
          >
            GBIF page
          </a>
        )}
      </div>
      <p className="text-body font-semibold text-canopy-950">{match.scientificName ?? '—'}</p>
      <dl className="flex flex-col gap-1">
        <Row label="Rank" value={match.rank} />
        <Row label="Status" value={match.status} />
        <Row label="Family" value={match.family} />
        <Row label="Genus" value={match.genus} />
        <Row
          label="Confidence"
          value={match.confidence === null ? null : String(match.confidence)}
        />
      </dl>
      {match.note ? <p className="text-meta text-mist-500">{match.note}</p> : null}
    </section>
  );
}

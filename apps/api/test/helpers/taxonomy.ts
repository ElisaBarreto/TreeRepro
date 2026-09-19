import type { TaxonMatch } from '@treerepro/contracts';
import type { TaxonomyClient, TaxonomyLookup } from '../../src/integrations/taxonomy.ts';

/**
 * A real source that answered and found nothing (RFC-81 R2's `NULL_MATCH`):
 * `matchType: 'NONE'` and every other field `null`. `null` itself is
 * reserved for a call that did not complete — the two are different facts
 * and the fake's default must not conflate them (RFC-81 R3).
 */
const NO_MATCH: TaxonMatch = {
  matchType: 'NONE',
  confidence: null,
  usageKey: null,
  scientificName: null,
  canonicalName: null,
  rank: null,
  status: null,
  family: null,
  genus: null,
  acceptedUsageKey: null,
  note: null,
};

/**
 * In-memory taxonomy client for tests. Set `answers` to control what
 * `match(name)` returns for a given name; the default (no answer
 * registered) is a genuine no-match — both sources answered and found
 * nothing (`matchType: 'NONE'`), verdict `none` — matching what a real
 * client answers for a name GBIF has never heard of. Set `failing` to
 * simulate every attempted GBIF call failing instead (both sources `null`,
 * verdict `failed`), per RFC-81 R3 — the two outcomes are never the same
 * shape.
 * @rfc RFC-81 R1
 */
export function fakeTaxonomyClient(): TaxonomyClient & {
  answers: Map<string, TaxonomyLookup>;
  failing: boolean;
} {
  const answers = new Map<string, TaxonomyLookup>();
  let failing = false;
  return {
    get answers() {
      return answers;
    },
    get failing() {
      return failing;
    },
    set failing(v: boolean) {
      failing = v;
    },
    async match(name) {
      if (failing) return { backbone: null, wcvp: null, verdict: 'failed' };
      return answers.get(name) ?? { backbone: NO_MATCH, wcvp: NO_MATCH, verdict: 'none' };
    },
  };
}

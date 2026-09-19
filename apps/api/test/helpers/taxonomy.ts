import type { TaxonomyClient, TaxonomyLookup } from '../../src/integrations/taxonomy.ts';

/**
 * In-memory taxonomy client for tests. Set `answers` to control what
 * `match(name)` returns for a given name (default: `none`, matching what a
 * real client would answer for a name GBIF has never heard of); set
 * `failing` to simulate every attempted GBIF call failing, per RFC-81 R3.
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
      return answers.get(name) ?? { backbone: null, wcvp: null, verdict: 'none' };
    },
  };
}

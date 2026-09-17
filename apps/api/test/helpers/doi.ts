import type { DoiClient, DoiMetadata } from '../../src/integrations/doi.ts';

/**
 * In-memory DOI client for tests. Set `known` to control `exists` / `metadata`
 * results; set `failing` to simulate a registry outage.
 * @rfc RFC-80 R2
 */
export function fakeDoiClient(): DoiClient & {
  known: Map<string, DoiMetadata | null>;
  failing: boolean;
} {
  const known = new Map<string, DoiMetadata | null>();
  let failing = false;
  return {
    get known() {
      return known;
    },
    get failing() {
      return failing;
    },
    set failing(v: boolean) {
      failing = v;
    },
    async exists(doi) {
      if (failing) return 'failed';
      return known.has(doi) ? 'resolvable' : 'not_found';
    },
    async metadata(doi) {
      if (failing) return null;
      return known.get(doi) ?? null;
    },
  };
}

/**
 * DOI resolution via the Handle API and Crossref Works API.
 * @rfc RFC-80 R1, R2, R3
 */
import { fetchJsonFixedHost } from './http.ts';

export interface DoiMetadata {
  title: string | null;
  authors: string | null;
  year: number | null;
  journal: string | null;
}

export interface DoiClient {
  exists(doi: string): Promise<'resolvable' | 'not_found' | 'failed'>;
  metadata(doi: string): Promise<DoiMetadata | null>;
}

const DOI_PATTERN = /^10\.\d{4,9}\/\S{1,200}$/;
const PREFIXES = [
  'https://doi.org/',
  'http://doi.org/',
  'https://dx.doi.org/',
  'http://dx.doi.org/',
  'doi:',
];

/**
 * A DOI pasted from a browser's address bar arrives percent-encoded
 * (`%3C857` for `<857`), and storing that literally would have the web's
 * `doiHref` encode the `%` again (`%253C`) into a link doi.org cannot
 * resolve. Decoded exactly once — `%2523` is the DOI `…%23…`, not `…#…` —
 * and a `%` that starts no valid escape (`10.1234/100%`) is a literal
 * character of the DOI, which `decodeURIComponent` reports by throwing.
 */
function percentDecodeOnce(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Strip resolver prefixes, percent-decode once, lowercase, validate format.
 * What is stored is the canonical DOI; the render side stays the single
 * encoder.
 * @rfc RFC-80 R1
 */
export function normaliseDoi(text: string): string | null {
  let s = text.trim();
  const lower = s.toLowerCase();
  for (const p of PREFIXES) {
    if (lower.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  s = percentDecodeOnce(s).toLowerCase();
  return DOI_PATTERN.test(s) ? s : null;
}

/** Map a Crossref `/works/:doi` response to our metadata shape. @rfc RFC-61 R8 */
export function crossrefToMetadata(work: unknown): DoiMetadata {
  const m = (work as { message?: Record<string, unknown> })?.message ?? {};
  const title =
    Array.isArray(m.title) && typeof m.title[0] === 'string' ? (m.title[0] as string) : null;
  const authors = Array.isArray(m.author)
    ? (m.author as { family?: string; given?: string; name?: string }[])
        .map((a) => [a.family, a.given].filter(Boolean).join(', ') || a.name || '')
        .filter(Boolean)
        .join('; ')
        .slice(0, 1000) || null
    : null;
  const parts = (m.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0];
  const year = parts && Number.isInteger(parts[0]) ? (parts[0] as number) : null;
  const journal =
    Array.isArray(m['container-title']) && typeof m['container-title'][0] === 'string'
      ? (m['container-title'][0] as string)
      : null;
  return { title, authors, year, journal };
}

/**
 * The display short citation derived from resolved metadata: the first
 * author's family name alone for one author; `<family> and <family>` for
 * two; `<family> et al.` for three or more; then ` (<year>)` when a year is
 * known. The family name of an author entry is the part before its first
 * comma (entries are `;`-separated, as {@link crossrefToMetadata} joins
 * them). `null` when there are no authors at all.
 * @rfc RFC-61 R8
 */
export function shortCitationFrom(metadata: Pick<DoiMetadata, 'authors' | 'year'>): string | null {
  if (!metadata.authors) return null;
  const families = metadata.authors
    .split(';')
    .map((entry) => entry.split(',')[0]?.trim() ?? '')
    .filter(Boolean);
  const [first, second] = families;
  if (!first) return null;
  const names =
    families.length === 1
      ? first
      : families.length === 2
        ? `${first} and ${second}`
        : `${first} et al.`;
  return metadata.year != null ? `${names} (${metadata.year})` : names;
}

/** @rfc RFC-80 R2, R3 */
export function createDoiClient(options: {
  contactEmail?: string;
  version: string;
  fetchImpl?: typeof fetch;
}): DoiClient {
  const ua = `TreeRepro/${options.version}${options.contactEmail ? ` (mailto:${options.contactEmail})` : ''}`;
  const headers = { 'user-agent': ua };
  return {
    async exists(doi) {
      const r = await fetchJsonFixedHost({
        url: new URL(`https://doi.org/api/handles/${encodeURIComponent(doi)}`),
        allowedHost: 'doi.org',
        headers,
        fetchImpl: options.fetchImpl,
      });
      if (r.ok) {
        // Handle API response codes: 1 resolved, 100 handle not found. Any
        // other code (2 "error", 200 "values not found", or none at all) says
        // nothing about the DOI, so it is a failure, not an absence.
        const code = (r.json as { responseCode?: number }).responseCode;
        if (code === 1) return 'resolvable';
        if (code === 100) return 'not_found';
        return 'failed';
      }
      if ('status' in r && r.status === 404) return 'not_found';
      return 'failed';
    },
    async metadata(doi) {
      const r = await fetchJsonFixedHost({
        url: new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`),
        allowedHost: 'api.crossref.org',
        headers,
        fetchImpl: options.fetchImpl,
      });
      return r.ok ? crossrefToMetadata(r.json) : null;
    },
  };
}

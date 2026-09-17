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

/** Strip resolver prefixes, lowercase, validate format. @rfc RFC-80 R1 */
export function normaliseDoi(text: string): string | null {
  let s = text.trim();
  const lower = s.toLowerCase();
  for (const p of PREFIXES) {
    if (lower.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  s = s.toLowerCase();
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
  const parts = (
    m.issued as { 'date-parts'?: number[][] } | undefined
  )?.['date-parts']?.[0];
  const year = parts && Number.isInteger(parts[0]) ? (parts[0] as number) : null;
  const journal =
    Array.isArray(m['container-title']) && typeof m['container-title'][0] === 'string'
      ? (m['container-title'][0] as string)
      : null;
  return { title, authors, year, journal };
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
        return (r.json as { responseCode?: number }).responseCode === 1 ? 'resolvable' : 'not_found';
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

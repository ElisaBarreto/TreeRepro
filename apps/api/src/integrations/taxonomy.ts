/**
 * GBIF taxonomy lookup: the backbone match (v2) and the WCVP dataset-scoped
 * name search (v1), mapped into the shared `TaxonMatch` shape and combined
 * into a verdict.
 * @rfc RFC-81 R1, R2, R3
 */
import type { LookupVerdict, TaxonMatch, Lookup as TaxonomyLookup } from '@treerepro/contracts';
import { fetchJsonFixedHost } from './http.ts';

export type { TaxonomyLookup };

const GBIF_HOST = 'api.gbif.org';

/** @rfc RFC-81 R1 */
export interface TaxonomyClient {
  match(name: string): Promise<TaxonomyLookup>;
}

const KNOWN_MATCH_TYPES: ReadonlySet<string> = new Set([
  'EXACT',
  'VARIANT',
  'FUZZY',
  'HIGHERRANK',
  'NONE',
]);

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNumber = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const asKey = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
/**
 * The mappers stay total: a shape they did not expect degrades to nulls and
 * never throws, because a stored `lookup` is re-read long after the call and
 * a throw here would 500 a contributor's proposal. What a malformed body
 * must *not* do is pass for an answer — that is decided one layer up, by the
 * shape checks below, before either mapper is reached.
 */
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Is this 2xx body the backbone answer RFC-81 R2 documents? A `NONE` match
 * carries `diagnostics` and nothing else — no `usage`, no `classification` —
 * so those two are optional, but anything present must have its documented
 * shape. A body without a `diagnostics.matchType` string is not an answer
 * about the name: mapping it would silently yield `matchType 'NONE'`, which
 * R-K reserves for "GBIF checked and found nothing".
 * @rfc RFC-81 R2, R3
 */
function isBackboneBody(json: unknown): boolean {
  if (!isObject(json)) return false;
  const { usage, acceptedUsage, classification, diagnostics } = json;
  if (!isObject(diagnostics) || typeof diagnostics.matchType !== 'string') return false;
  if (usage != null && !isObject(usage)) return false;
  if (acceptedUsage != null && !isObject(acceptedUsage)) return false;
  if (classification != null && (!Array.isArray(classification) || !classification.every(isObject)))
    return false;
  return true;
}

/**
 * Is this 2xx body the WCVP answer RFC-81 R2 documents? `results` is
 * required — a genuine miss sends `results: []`, so a body without it, or
 * with rows that are not objects, is a malformed answer and not a miss.
 * @rfc RFC-81 R2, R3
 */
function isWcvpBody(json: unknown): boolean {
  return isObject(json) && Array.isArray(json.results) && json.results.every(isObject);
}

/**
 * A note naming the matched rank when it is above species, and `null`
 * otherwise (including no match at all, where `rank` is `null`). GBIF sends
 * no `diagnostics.note` in practice; this is what both mappers fall back to.
 */
function synthesiseNote(rank: string | null): string | null {
  if (!rank || rank === 'SPECIES') return null;
  return `matched the ${rank.toLowerCase()}`;
}

interface BackboneJson {
  usage?: {
    key?: unknown;
    name?: unknown;
    canonicalName?: unknown;
    rank?: unknown;
    status?: unknown;
  };
  acceptedUsage?: { key?: unknown };
  classification?: { name?: unknown; rank?: unknown }[];
  diagnostics?: { matchType?: unknown; confidence?: unknown; note?: unknown };
}

/**
 * Maps a `GET /v2/species/match` response to the shared `TaxonMatch` shape.
 * `family`/`genus` come from `classification[]` by rank; a `matchType`
 * outside the known set (a value GBIF might add later) maps to `NONE`
 * rather than throwing — the mapper is best-effort and a stored `lookup` is
 * re-read long after this call.
 * @rfc RFC-81 R2
 */
export function gbifToMatch(json: unknown): TaxonMatch {
  const j = (json ?? {}) as BackboneJson;
  const rawType = j.diagnostics?.matchType;
  const matchType = (
    typeof rawType === 'string' && KNOWN_MATCH_TYPES.has(rawType) ? rawType : 'NONE'
  ) as TaxonMatch['matchType'];
  const usage = j.usage;
  const classification = asArray(j.classification).map(asRecord);
  const family = asString(classification.find((c) => c.rank === 'FAMILY')?.name);
  const genus = asString(classification.find((c) => c.rank === 'GENUS')?.name);
  const rank = asString(usage?.rank);
  return {
    matchType,
    confidence: asNumber(j.diagnostics?.confidence),
    usageKey: asKey(usage?.key),
    scientificName: asString(usage?.name),
    canonicalName: asString(usage?.canonicalName),
    rank,
    status: asString(usage?.status),
    family,
    genus,
    acceptedUsageKey: asKey(j.acceptedUsage?.key),
    note: asString(j.diagnostics?.note) ?? synthesiseNote(rank),
  };
}

interface WcvpRow {
  key?: unknown;
  scientificName?: unknown;
  canonicalName?: unknown;
  rank?: unknown;
  taxonomicStatus?: unknown;
  family?: unknown;
  genus?: unknown;
  acceptedKey?: unknown;
}

interface WcvpJson {
  results?: WcvpRow[];
}

const NULL_MATCH: TaxonMatch = {
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
 * Maps a `GET /v1/species?datasetKey=<WCVP>` response to the shared
 * `TaxonMatch` shape. `results[0]` is not reliably the right taxon — the
 * selected row is the first with `taxonomicStatus === 'ACCEPTED'`, or the
 * first row if none is (R-A: `Pinus sylvestris` returns a `MISAPPLIED` row
 * before the `ACCEPTED` one). An empty `results` (HTTP 200, not an error)
 * maps to `NONE`.
 * @rfc RFC-81 R2
 */
export function wcvpToMatch(json: unknown): TaxonMatch {
  const results = asArray((json as WcvpJson)?.results).map(asRecord);
  if (results.length === 0) return NULL_MATCH;
  const row: WcvpRow = asRecord(
    results.find((r) => r.taxonomicStatus === 'ACCEPTED') ?? results[0],
  );
  const rank = asString(row.rank);
  return {
    matchType: rank === 'SPECIES' ? 'EXACT' : 'HIGHERRANK',
    confidence: null,
    usageKey: asKey(row.key),
    scientificName: asString(row.scientificName),
    canonicalName: asString(row.canonicalName),
    rank,
    status: asString(row.taxonomicStatus),
    family: asString(row.family),
    genus: asString(row.genus),
    acceptedUsageKey: asKey(row.acceptedKey),
    note: synthesiseNote(rank),
  };
}

/**
 * The verdict over however many sources were attempted. `exact` requires a
 * source matching `EXACT` **at `rank === 'SPECIES'`** — an `EXACT` match at
 * genus rank (proposing the genus itself) is not `exact` (R-J). `fuzzy` is
 * driven by `VARIANT` or `FUZZY` on either source (R-I). `failed` only when
 * both sources are absent (failed or not attempted) and at least one call
 * actually failed — the backbone is always attempted, so a `null` backbone
 * always means a real failure (R-K); `none` is reserved for a call that
 * succeeded and found nothing. A 2xx with a malformed body is counted as a
 * failed call by the client, never as a source that found nothing.
 * @rfc RFC-81 R3
 */
export function verdictOf(
  backbone: TaxonMatch | null,
  wcvp: TaxonMatch | null,
  failures: number,
): LookupVerdict {
  const isExact = (m: TaxonMatch | null) => m?.matchType === 'EXACT' && m.rank === 'SPECIES';
  const isFuzzy = (m: TaxonMatch | null) => m?.matchType === 'VARIANT' || m?.matchType === 'FUZZY';
  if (isExact(backbone) || isExact(wcvp)) return 'exact';
  if (isFuzzy(backbone) || isFuzzy(wcvp)) return 'fuzzy';
  if (backbone === null && wcvp === null && failures > 0) return 'failed';
  return 'none';
}

/** @rfc RFC-81 R1 */
export function createTaxonomyClient(o: {
  /** `null` skips the WCVP call; the verdict then comes from the backbone alone. */
  wcvpDatasetKey: string | null;
  version: string;
  fetchImpl?: typeof fetch;
}): TaxonomyClient {
  return {
    async match(name) {
      const backboneUrl = new URL(
        `https://${GBIF_HOST}/v2/species/match?scientificName=${encodeURIComponent(name)}`,
      );
      const backboneRes = await fetchJsonFixedHost({
        url: backboneUrl,
        allowedHost: GBIF_HOST,
        fetchImpl: o.fetchImpl,
      });
      // A 2xx whose body is not the documented shape counts as a failed
      // call, not as an answer: `none` and `failed` say different things
      // about the same proposal (R-K) and only one of them is the
      // platform's fault.
      const backboneOk = backboneRes.ok && isBackboneBody(backboneRes.json);
      const backbone = backboneOk ? gbifToMatch(backboneRes.json) : null;
      let failures = backboneOk ? 0 : 1;

      let wcvp: TaxonMatch | null = null;
      if (o.wcvpDatasetKey) {
        const wcvpUrl = new URL(
          `https://${GBIF_HOST}/v1/species?datasetKey=${encodeURIComponent(o.wcvpDatasetKey)}&name=${encodeURIComponent(name)}&limit=5`,
        );
        const wcvpRes = await fetchJsonFixedHost({
          url: wcvpUrl,
          allowedHost: GBIF_HOST,
          fetchImpl: o.fetchImpl,
        });
        const wcvpOk = wcvpRes.ok && isWcvpBody(wcvpRes.json);
        wcvp = wcvpOk ? wcvpToMatch(wcvpRes.json) : null;
        if (!wcvpOk) failures += 1;
      }

      return { backbone, wcvp, verdict: verdictOf(backbone, wcvp, failures) };
    },
  };
}

/**
 * Start-up check confirming `WCVP_GBIF_DATASET_KEY` really names the WCVP
 * checklist before the process trusts it: `GET /v1/dataset/<key>`, `title`
 * must contain "World Checklist of Vascular Plants". An unset key skips the
 * call; any failure (network, wrong title, non-2xx) logs a warning and
 * returns `null` (the WCVP call disabled for the process) — this never
 * blocks or fails start-up.
 * @rfc RFC-81 R1
 */
export async function verifyWcvpDataset(o: {
  datasetKey: string | undefined;
  logger: { warn: (...args: unknown[]) => void };
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  if (!o.datasetKey) return null;
  const datasetKey = o.datasetKey;
  const r = await fetchJsonFixedHost({
    url: new URL(`https://${GBIF_HOST}/v1/dataset/${encodeURIComponent(datasetKey)}`),
    allowedHost: GBIF_HOST,
    fetchImpl: o.fetchImpl,
  });
  const title = r.ok ? asString((r.json as { title?: unknown }).title) : null;
  if (title?.includes('World Checklist of Vascular Plants')) return datasetKey;
  o.logger.warn({ datasetKey }, 'WCVP dataset check failed; disabling WCVP taxonomy lookup');
  return null;
}

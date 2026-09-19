import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeTaxonomyClient } from '../../test/helpers/taxonomy.ts';
import {
  createTaxonomyClient,
  gbifToMatch,
  verdictOf,
  verifyWcvpDataset,
  wcvpToMatch,
} from './taxonomy.ts';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/gbif/${name}.json`, import.meta.url), 'utf8'));
}

describe('RFC-81 R2 gbifToMatch', () => {
  it('maps an EXACT species match, taking family/genus off the classification', () => {
    expect(gbifToMatch(fixture('backbone-exact'))).toEqual({
      matchType: 'EXACT',
      confidence: 97,
      usageKey: '2878688',
      scientificName: 'Quercus robur L.',
      canonicalName: 'Quercus robur',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      family: 'Fagaceae',
      genus: 'Quercus',
      acceptedUsageKey: null,
      note: null,
    });
  });

  it('maps a VARIANT (misspelling) match at species rank — never FUZZY, per R-I', () => {
    const match = gbifToMatch(fixture('backbone-variant'));
    expect(match.matchType).toBe('VARIANT');
    expect(match.rank).toBe('SPECIES');
    expect(match.canonicalName).toBe('Quercus robur');
  });

  it('an EXACT match at genus rank (the genus name itself) stays EXACT, not HIGHERRANK — R-J', () => {
    const match = gbifToMatch(fixture('backbone-exact-genus'));
    expect(match.matchType).toBe('EXACT');
    expect(match.rank).toBe('GENUS');
    // GBIF sends no diagnostics.note; the mapper synthesises one because the
    // matched rank is above species.
    expect(match.note).toBe('matched the genus');
  });

  it('a species name that only resolves to its genus is HIGHERRANK, with a synthesised note — R-J', () => {
    const match = gbifToMatch(fixture('backbone-higherrank-fallback'));
    expect(match.matchType).toBe('HIGHERRANK');
    expect(match.rank).toBe('GENUS');
    expect(match.note).toBe('matched the genus');
  });

  it('NONE has no usage block at all and maps to nulls', () => {
    expect(gbifToMatch(fixture('backbone-none'))).toEqual({
      matchType: 'NONE',
      confidence: 100,
      usageKey: null,
      scientificName: null,
      canonicalName: null,
      rank: null,
      status: null,
      family: null,
      genus: null,
      acceptedUsageKey: null,
      note: null,
    });
  });

  it('a matchType outside the known set maps to NONE rather than throwing (a stored lookup must stay readable)', () => {
    expect(gbifToMatch({ diagnostics: { matchType: 'SOMETHING_GBIF_ADDS_LATER' } }).matchType).toBe(
      'NONE',
    );
  });

  it('REGRESSION: a malformed 2xx body never throws — a best-effort mapper degrades, it does not 500 a proposal', () => {
    // classification not an array at all
    expect(() => gbifToMatch({ classification: 'not-an-array' })).not.toThrow();
    expect(gbifToMatch({ classification: 'not-an-array' }).family).toBeNull();
    // classification an array of non-object entries (null, a number, a string)
    expect(() => gbifToMatch({ classification: [null, 1, 'x'] })).not.toThrow();
    expect(gbifToMatch({ classification: [null, 1, 'x'] }).genus).toBeNull();
    // the whole body is a scalar, not an object
    expect(() => gbifToMatch('not-an-object')).not.toThrow();
    expect(() => gbifToMatch(42)).not.toThrow();
    expect(() => gbifToMatch(null)).not.toThrow();
    // diagnostics/usage themselves malformed
    expect(() => gbifToMatch({ usage: 'nope', diagnostics: 'nope' })).not.toThrow();
    expect(gbifToMatch({ usage: 'nope', diagnostics: 'nope' })).toEqual({
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
    });
  });
});

describe('RFC-81 R2 wcvpToMatch', () => {
  it('maps a single ACCEPTED species row', () => {
    expect(wcvpToMatch(fixture('wcvp-exact'))).toEqual({
      matchType: 'EXACT',
      confidence: null,
      usageKey: '207128214',
      scientificName: 'Quercus robur L.',
      canonicalName: 'Quercus robur',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      family: 'Fagaceae',
      genus: 'Quercus',
      acceptedUsageKey: null,
      note: null,
    });
  });

  it('maps an ACCEPTED genus row as HIGHERRANK with a synthesised note', () => {
    const match = wcvpToMatch(fixture('wcvp-genus'));
    expect(match.matchType).toBe('HIGHERRANK');
    expect(match.rank).toBe('GENUS');
    expect(match.note).toBe('matched the genus');
  });

  it('empty results is a miss, HTTP 200, mapped to NONE — not an error', () => {
    expect(wcvpToMatch(fixture('wcvp-none'))).toEqual({
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
    });
  });

  it('REGRESSION: a malformed 2xx body never throws — a best-effort mapper degrades, it does not 500 a proposal', () => {
    // results not an array at all
    expect(() => wcvpToMatch({ results: 'not-an-array' })).not.toThrow();
    expect(wcvpToMatch({ results: 'not-an-array' }).matchType).toBe('NONE');
    // results an array of non-object entries (null, a number, a string)
    expect(() => wcvpToMatch({ results: [null, 1, 'x'] })).not.toThrow();
    // the whole body is a scalar, not an object
    expect(() => wcvpToMatch('not-an-object')).not.toThrow();
    expect(() => wcvpToMatch(42)).not.toThrow();
    expect(() => wcvpToMatch(null)).not.toThrow();
  });

  it('REGRESSION (R-A): Pinus sylvestris returns MISAPPLIED before ACCEPTED — the first ACCEPTED row wins, not results[0]', () => {
    const match = wcvpToMatch(fixture('wcvp-misapplied-first'));
    expect(match.usageKey).toBe('207484307'); // the ACCEPTED row's key, not 207484214 (MISAPPLIED, first in the array)
    expect(match.status).toBe('ACCEPTED');
    expect(match.scientificName).toBe('Pinus sylvestris L.');
    expect(match.acceptedUsageKey).toBeNull(); // the ACCEPTED row itself carries no acceptedKey
  });
});

describe('RFC-81 R3 verdictOf', () => {
  const exactSpecies = gbifToMatch(fixture('backbone-exact'));
  const variant = gbifToMatch(fixture('backbone-variant'));
  const exactGenus = gbifToMatch(fixture('backbone-exact-genus'));
  const higherRank = gbifToMatch(fixture('backbone-higherrank-fallback'));
  const none = gbifToMatch(fixture('backbone-none'));

  it('EXACT at species rank on either source → exact', () => {
    expect(verdictOf(exactSpecies, null, 0)).toBe('exact');
    expect(verdictOf(null, exactSpecies, 0)).toBe('exact');
  });

  it('an EXACT match at genus rank is not exact (R-J is load-bearing here)', () => {
    expect(verdictOf(exactGenus, null, 0)).toBe('none');
  });

  it('VARIANT or FUZZY on either source, when not exact → fuzzy', () => {
    expect(verdictOf(variant, null, 0)).toBe('fuzzy');
    expect(verdictOf(null, variant, 0)).toBe('fuzzy');
  });

  it('both NONE/HIGHERRANK, neither exact nor fuzzy → none', () => {
    expect(verdictOf(none, higherRank, 0)).toBe('none');
  });

  it('both attempted calls failed → failed', () => {
    expect(verdictOf(null, null, 2)).toBe('failed');
  });

  it('one failed + one NONE succeeded → none, not failed (a platform fault is not an answer about the name) — R-K', () => {
    expect(verdictOf(null, none, 1)).toBe('none');
    expect(verdictOf(none, null, 1)).toBe('none');
  });
});

describe('RFC-81 R1 createTaxonomyClient', () => {
  let calls: string[] = [];

  it('calls only the GBIF v2 backbone match when no WCVP dataset key is configured', async () => {
    calls = [];
    const client = createTaxonomyClient({
      wcvpDatasetKey: null,
      version: '1.0',
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify(fixture('backbone-exact')), { status: 200 });
      },
    });
    const result = await client.match('Quercus robur');
    expect(calls).toEqual(['https://api.gbif.org/v2/species/match?scientificName=Quercus%20robur']);
    expect(result.backbone?.matchType).toBe('EXACT');
    expect(result.wcvp).toBeNull();
    expect(result.verdict).toBe('exact');
  });

  it('calls the v1 WCVP dataset-scoped name search too when a dataset key is configured — R-A, not v2 checklistKey', async () => {
    calls = [];
    const client = createTaxonomyClient({
      wcvpDatasetKey: 'f382f0ce-323a-4091-bb9f-add557f3a9a2',
      version: '1.0',
      fetchImpl: async (url) => {
        const u = String(url);
        calls.push(u);
        if (u.includes('/v2/species/match')) {
          return new Response(JSON.stringify(fixture('backbone-exact')), { status: 200 });
        }
        return new Response(JSON.stringify(fixture('wcvp-exact')), { status: 200 });
      },
    });
    await client.match('Quercus robur');
    expect(calls).toEqual([
      'https://api.gbif.org/v2/species/match?scientificName=Quercus%20robur',
      'https://api.gbif.org/v1/species?datasetKey=f382f0ce-323a-4091-bb9f-add557f3a9a2&name=Quercus%20robur&limit=5',
    ]);
  });

  it('WCVP answering with no rows is a NONE match, not a null — the two are different facts (R-K)', async () => {
    // The commonest real outcome for a name outside WCVP, and the shape the
    // web layer has to tell apart from a failed call: HTTP 200 with
    // `results: []` maps to a `TaxonMatch` whose `matchType` is `NONE` and
    // whose every other field is `null`, while a failed call maps to `null`.
    const client = createTaxonomyClient({
      wcvpDatasetKey: 'f382f0ce-323a-4091-bb9f-add557f3a9a2',
      version: '1.0',
      fetchImpl: async (url) => {
        const body = String(url).includes('/v2/species/match')
          ? fixture('backbone-exact')
          : fixture('wcvp-none');
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });
    const result = await client.match('Quercus robur');
    expect(result.wcvp).not.toBeNull();
    expect(result.wcvp).toEqual({
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
    });
    // The backbone matched exactly at species rank, so the verdict is
    // `exact` even though WCVP knows nothing about the name.
    expect(result.backbone?.matchType).toBe('EXACT');
    expect(result.verdict).toBe('exact');
  });

  it('a network failure on one call is a null for that source, and the other still answers', async () => {
    const client = createTaxonomyClient({
      wcvpDatasetKey: 'f382f0ce-323a-4091-bb9f-add557f3a9a2',
      version: '1.0',
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('/v2/species/match')) throw new TypeError('fetch failed');
        return new Response(JSON.stringify(fixture('wcvp-exact')), { status: 200 });
      },
    });
    const result = await client.match('Quercus robur');
    expect(result.backbone).toBeNull();
    expect(result.wcvp?.matchType).toBe('EXACT');
    expect(result.verdict).toBe('exact');
  });

  it('both calls failing → lookup: backbone null, wcvp null, verdict failed — R-K', async () => {
    const client = createTaxonomyClient({
      wcvpDatasetKey: 'f382f0ce-323a-4091-bb9f-add557f3a9a2',
      version: '1.0',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const result = await client.match('Quercus robur');
    expect(result).toEqual({ backbone: null, wcvp: null, verdict: 'failed' });
  });

  it('the lone backbone call failing with WCVP disabled is failed, not none — R-K', async () => {
    const client = createTaxonomyClient({
      wcvpDatasetKey: null,
      version: '1.0',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const result = await client.match('Quercus robur');
    expect(result).toEqual({ backbone: null, wcvp: null, verdict: 'failed' });
  });
});

describe('RFC-81 R1 verifyWcvpDataset', () => {
  it('unset key: no network call, returns null', async () => {
    let called = false;
    const key = await verifyWcvpDataset({
      datasetKey: undefined,
      logger: { warn: () => {} },
      fetchImpl: async () => {
        called = true;
        return new Response('{}', { status: 200 });
      },
    });
    expect(key).toBeNull();
    expect(called).toBe(false);
  });

  it('title contains "World Checklist of Vascular Plants": key confirmed', async () => {
    const key = await verifyWcvpDataset({
      datasetKey: 'f382f0ce-323a-4091-bb9f-add557f3a9a2',
      logger: { warn: () => {} },
      fetchImpl: async () => new Response(JSON.stringify(fixture('wcvp-dataset')), { status: 200 }),
    });
    expect(key).toBe('f382f0ce-323a-4091-bb9f-add557f3a9a2');
  });

  it('any failure (network, wrong title, non-2xx) logs a warning and returns null — never throws', async () => {
    const warnings: unknown[] = [];
    const key = await verifyWcvpDataset({
      datasetKey: 'bad-key',
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
      fetchImpl: async () => new Response('{}', { status: 404 }),
    });
    expect(key).toBeNull();
    expect(warnings.length).toBe(1);
  });
});

describe('RFC-81 R3 fakeTaxonomyClient (apps/api/test/helpers/taxonomy.ts)', () => {
  it('REGRESSION: the default (no answer registered) is a genuine no-match — two NONE matches, never the two-nulls "failed" shape', async () => {
    // A real client's no-match is a TaxonMatch with matchType 'NONE' (NULL_MATCH),
    // not `null` — `null` means the call failed. A fake whose default returns
    // `{ backbone: null, wcvp: null, verdict: 'none' }` encodes a combination
    // the real client can never produce (verdictOf only returns 'none' when
    // at least one source answered), so every test reading that default would
    // agree with a false model.
    const client = fakeTaxonomyClient();
    const result = await client.match('Name nobody registered an answer for');
    expect(result.verdict).toBe('none');
    expect(result.backbone).not.toBeNull();
    expect(result.wcvp).not.toBeNull();
    expect(result.backbone?.matchType).toBe('NONE');
    expect(result.wcvp?.matchType).toBe('NONE');
  });

  it('failing still answers the real failed shape: both null, verdict failed', async () => {
    const client = fakeTaxonomyClient();
    client.failing = true;
    expect(await client.match('anything')).toEqual({
      backbone: null,
      wcvp: null,
      verdict: 'failed',
    });
  });

  it('a registered answer for the exact name is returned verbatim', async () => {
    const client = fakeTaxonomyClient();
    const canned = {
      backbone: gbifToMatch(fixture('backbone-exact')),
      wcvp: null,
      verdict: 'exact' as const,
    };
    client.answers.set('Quercus robur', canned);
    expect(await client.match('Quercus robur')).toEqual(canned);
  });
});

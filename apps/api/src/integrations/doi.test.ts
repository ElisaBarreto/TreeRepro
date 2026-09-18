import { describe, expect, it } from 'vitest';
import { createDoiClient, crossrefToMetadata, normaliseDoi, shortCitationFrom } from './doi.ts';

describe('RFC-80 R1 normaliseDoi', () => {
  it('strips resolver prefixes, lowercases, validates', () => {
    expect(normaliseDoi(' https://doi.org/10.1111/GEB.13000 ')).toBe('10.1111/geb.13000');
    expect(normaliseDoi('doi:10.5061/dryad.abc')).toBe('10.5061/dryad.abc');
    expect(normaliseDoi('http://dx.doi.org/10.1/x')).toBeNull(); // registrant too short
    expect(normaliseDoi('11.1111/x')).toBeNull();
    expect(normaliseDoi('10.1111/')).toBeNull();
    expect(normaliseDoi(`10.1111/${'a'.repeat(201)}`)).toBeNull();
  });
});

describe('RFC-61 R8 crossrefToMetadata', () => {
  it('maps a Crossref work', () => {
    expect(
      crossrefToMetadata({
        message: {
          title: ['Seed size'],
          author: [
            { family: 'Alfaro', given: 'A' },
            { family: 'Diaz', given: 'B' },
          ],
          issued: { 'date-parts': [[2023, 4]] },
          'container-title': ['Global Ecology'],
        },
      }),
    ).toEqual({
      title: 'Seed size',
      authors: 'Alfaro, A; Diaz, B',
      year: 2023,
      journal: 'Global Ecology',
    });
    expect(crossrefToMetadata({ message: {} })).toEqual({
      title: null,
      authors: null,
      year: null,
      journal: null,
    });
  });
});

describe('RFC-61 R8 shortCitationFrom', () => {
  it('one author: family name alone, then the year', () => {
    expect(shortCitationFrom({ authors: 'Alfaro, A', year: 2023 })).toBe('Alfaro (2023)');
  });

  it('two authors: "and" joins their family names, then the year', () => {
    expect(shortCitationFrom({ authors: 'Alfaro, A; Diaz, B', year: 2023 })).toBe(
      'Alfaro and Diaz (2023)',
    );
  });

  it('three or more authors: the first family name, "et al.", then the year', () => {
    expect(shortCitationFrom({ authors: 'Alfaro, A; Diaz, B; Silva, C', year: 2023 })).toBe(
      'Alfaro et al. (2023)',
    );
  });

  it('no year: the family-name part alone, with no parenthesis', () => {
    expect(shortCitationFrom({ authors: 'Alfaro, A; Diaz, B; Silva, C', year: null })).toBe(
      'Alfaro et al.',
    );
  });

  it('no authors: null', () => {
    expect(shortCitationFrom({ authors: null, year: 2023 })).toBeNull();
  });

  it("the family name is the part before the first entry's first comma only", () => {
    expect(shortCitationFrom({ authors: 'Alfaro, A, Jr; Diaz, B', year: 2023 })).toBe(
      'Alfaro and Diaz (2023)',
    );
  });
});

describe('RFC-80 R2, R3 createDoiClient', () => {
  const respond =
    (status: number, body: unknown, headers: Record<string, string> = {}) =>
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });

  it('exists: 1 → resolvable; 100 or 404 → not_found; any other code, redirect or network → failed', async () => {
    expect(
      await createDoiClient({
        version: 't',
        fetchImpl: respond(200, { responseCode: 1 }),
      }).exists('10.1/x'),
    ).toBe('resolvable');
    expect(
      await createDoiClient({
        version: 't',
        fetchImpl: respond(200, { responseCode: 100 }),
      }).exists('10.1/x'),
    ).toBe('not_found');
    expect(
      await createDoiClient({ version: 't', fetchImpl: respond(404, {}) }).exists('10.1/x'),
    ).toBe('not_found');
    // Any other Handle code (2 "error", 200 "values not found", none at all)
    // says nothing about the DOI, so it is a failure, not an absence.
    expect(
      await createDoiClient({ version: 't', fetchImpl: respond(200, { responseCode: 2 }) }).exists(
        '10.1/x',
      ),
    ).toBe('failed');
    expect(
      await createDoiClient({ version: 't', fetchImpl: respond(200, {}) }).exists('10.1/x'),
    ).toBe('failed');
    expect(
      await createDoiClient({
        version: 't',
        fetchImpl: respond(302, {}, { location: 'https://x' }),
      }).exists('10.1/x'),
    ).toBe('failed');
    expect(
      await createDoiClient({
        version: 't',
        fetchImpl: async () => {
          throw new TypeError('fetch failed');
        },
      }).exists('10.1/x'),
    ).toBe('failed');
  });

  it('calls the two fixed hosts only, with the User-Agent', async () => {
    const calls: { url: string; ua: string | null }[] = [];
    const client = createDoiClient({
      version: '1.2',
      contactEmail: 'ops@example.test',
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          ua: new Headers(init?.headers as Record<string, string> | undefined).get('user-agent'),
        });
        return new Response('{"responseCode":1,"message":{}}', { status: 200 });
      },
    });
    await client.exists('10.1111/geb.13000');
    await client.metadata('10.1111/geb.13000');
    expect(calls.map((c) => c.url)).toEqual([
      'https://doi.org/api/handles/10.1111%2Fgeb.13000',
      'https://api.crossref.org/works/10.1111%2Fgeb.13000',
    ]);
    expect(calls[0]?.ua).toBe('TreeRepro/1.2 (mailto:ops@example.test)');
  });
});

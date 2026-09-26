import { describe, expect, it } from 'vitest';
import { createAdminKey } from '../../test/helpers/api-keys.ts';
import { call, useTestApp } from '../../test/helpers/app.ts';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { ROUTE_CATALOG } from './route-catalog.ts';

function mounted(routes: { method: string; path: string }[]): string[] {
  return [
    ...new Set(routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)),
  ].sort();
}

describe('RFC-82 R16 the route catalog lists exactly the mounted routes', () => {
  const t = useTestApp();

  it('every mounted route is catalogued and every catalogued route is mounted', () => {
    const routes = mounted(t.app.routes);
    expect(
      routes.filter((r) => !(r in ROUTE_CATALOG)),
      'missing from the catalog',
    ).toEqual([]);
    expect(
      Object.keys(ROUTE_CATALOG).filter((r) => !routes.includes(r)),
      'not mounted',
    ).toEqual([]);
  });

  it('every summary is one short line', () => {
    for (const [key, entry] of Object.entries(ROUTE_CATALOG)) {
      expect(entry.summary, key).toMatch(/^[^\n]{3,100}$/);
      expect(entry.summary.endsWith('.'), key).toBe(false);
    }
  });
});

describe('RFC-82 R16 catalogued response schemas match what the routes actually answer', () => {
  const t = useTestApp();

  it('parses the guide-named routes with their catalogued schema', async () => {
    const { headers } = await createAdminKey(t);
    const species = await createSpecies(t.db);
    const reference = await createReference(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue'] });
    const batch = await createImportBatch(t.db);
    // A pending group for GET /api/records/pending to list (RFC-65 R8).
    await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'reds',
      primaryReferenceId: reference.id,
      importBatchId: batch.id,
      harmonisation: 'unknown_level',
    });

    const gets: [keyof typeof ROUTE_CATALOG, string][] = [
      ['GET /api/records/pending/traits', '/api/records/pending/traits'],
      ['GET /api/records/pending', `/api/records/pending?traitId=${trait.id}`],
      ['GET /api/traits/:id', `/api/traits/${trait.id}`],
    ];
    for (const [key, path] of gets) {
      const res = await call(t.app, 'GET', path, { headers, origin: null });
      expect(res.status, key).toBe(200);
      const entry = ROUTE_CATALOG[key];
      if (!entry) throw new Error(`${key}: not in ROUTE_CATALOG`);
      const schema = entry.response;
      if (!schema) throw new Error(`${key}: no catalogued response schema to check against`);
      const body = await res.json();
      expect(() => schema.parse(body), key).not.toThrow();
    }

    const batchRes = await call(t.app, 'POST', '/api/batch', {
      headers,
      origin: null,
      body: { ops: [{ method: 'GET', path: '/api/health' }] },
    });
    expect(batchRes.status).toBe(200);
    const batchEntry = ROUTE_CATALOG['POST /api/batch'];
    if (!batchEntry) throw new Error('POST /api/batch: not in ROUTE_CATALOG');
    const batchSchema = batchEntry.response;
    if (!batchSchema)
      throw new Error('POST /api/batch: no catalogued response schema to check against');
    const batchBody = await batchRes.json();
    expect(() => batchSchema.parse(batchBody)).not.toThrow();
  });
});

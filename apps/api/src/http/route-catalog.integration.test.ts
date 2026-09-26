import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
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

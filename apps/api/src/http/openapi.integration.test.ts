import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { buildOpenApi, openApiHash } from './openapi.ts';
import { ROUTE_CATALOG } from './route-catalog.ts';

describe('RFC-82 R17 buildOpenApi', () => {
  const t = useTestApp();
  // biome-ignore lint/suspicious/noExplicitAny: the generated OpenAPI document is untyped JSON.
  const doc = () => buildOpenApi(t.app.routes) as any;

  it('is OpenAPI 3.1 with one operation per catalogued route, paths sorted', () => {
    const d = doc();
    expect(d.openapi).toBe('3.1.0');
    const ops = Object.entries(d.paths).flatMap(([p, item]) =>
      Object.keys(item as object).map((m) => `${m.toUpperCase()} ${p}`),
    );
    expect(ops.length).toBe(Object.keys(ROUTE_CATALOG).length);
    expect(Object.keys(d.paths)).toEqual([...Object.keys(d.paths)].sort());
  });

  it('converts :params to {params} and documents them as path parameters', () => {
    const op = doc().paths['/api/species/{id}'].get;
    expect(op.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
  });

  it('carries guard, permission and security', () => {
    const d = doc();
    expect(d.paths['/api/batch'].post['x-guard']).toBe('apiKey');
    expect(d.paths['/api/batch'].post.security).toEqual([{ bearerKey: [] }]);
    expect(d.paths['/api/health'].get['x-guard']).toBe('public');
    expect(d.paths['/api/health'].get.security).toEqual([]);
    const map = d.paths['/api/records/pending/map'].post;
    expect(map['x-guard']).toBe('permission');
    expect(map['x-permission']).toBe('records.review');
    expect(map.security).toEqual([{ sessionCookie: [] }, { bearerKey: [] }]);
    expect(d.paths['/api/auth/me'].get.security).toEqual([{ sessionCookie: [] }]);
  });

  it('documents the JSON body, query parameters, responses and the error body', () => {
    const d = doc();
    expect(
      d.paths['/api/records/pending/map'].post.requestBody.content['application/json'].schema.type,
    ).toBe('object');
    // biome-ignore lint/suspicious/noExplicitAny: the generated OpenAPI document is untyped JSON.
    const isQueryParam = (p: any) => p.in === 'query';
    expect(d.paths['/api/records/pending'].get.parameters.some(isQueryParam)).toBe(true);
    expect(
      d.paths['/api/batch'].post.responses['2XX'].content['application/json'].schema,
    ).toBeDefined();
    expect(
      d.paths['/api/batch'].post.responses.default.content['application/json'].schema,
    ).toBeDefined();
  });

  it('is deterministic', () => {
    expect(openApiHash(buildOpenApi(t.app.routes))).toBe(openApiHash(buildOpenApi(t.app.routes)));
    expect(openApiHash(doc())).toMatch(/^[0-9a-f]{64}$/);
  });
});

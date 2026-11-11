import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../test/helpers/logger.ts';
import type { AppEnv } from './env.ts';
import { createErrorHandler } from './errors.ts';
import { type PlatformDomains, platformOfHost, resolvePlatform } from './platform.ts';

const DEV = { tree: 'localhost', plant: 'plantrepro.localhost' };
const PROD = { tree: 'treerepro.elisabarreto.com.br', plant: 'plantrepro.elisabarreto.com.br' };

describe('RFC-14 R3 platformOfHost', () => {
  it('resolves the development hosts, ignoring the port', () => {
    expect(platformOfHost('localhost:8080', DEV)).toBe('treerepro');
    expect(platformOfHost('localhost', DEV)).toBe('treerepro');
    expect(platformOfHost('plantrepro.localhost:8080', DEV)).toBe('plantrepro');
  });

  it('resolves the production hosts', () => {
    expect(platformOfHost('treerepro.elisabarreto.com.br', PROD)).toBe('treerepro');
    expect(platformOfHost('plantrepro.elisabarreto.com.br', PROD)).toBe('plantrepro');
  });

  it('refuses the PlantRepro host when it has no domain', () => {
    expect(platformOfHost('plantrepro.elisabarreto.com.br', { ...PROD, plant: null })).toBeNull();
    expect(platformOfHost('plantrepro.localhost', { tree: 'localhost', plant: null })).toBeNull();
  });

  it('refuses an unknown or missing host', () => {
    expect(platformOfHost('evil.example', PROD)).toBeNull();
    expect(platformOfHost('127.0.0.1:3000', PROD)).toBeNull();
    expect(platformOfHost('treerepro.elisabarreto.com.br.evil.example', PROD)).toBeNull();
    expect(platformOfHost('', PROD)).toBeNull();
    expect(platformOfHost(undefined, PROD)).toBeNull();
  });

  it('ignores case', () => {
    expect(platformOfHost('TreeRepro.ElisaBarreto.com.br', PROD)).toBe('treerepro');
    expect(platformOfHost('PLANTREPRO.localhost:8080', DEV)).toBe('plantrepro');
  });
});

describe('RFC-14 R3 resolvePlatform middleware', () => {
  function app(domains: PlatformDomains = DEV) {
    const a = new Hono<AppEnv>();
    a.onError(createErrorHandler(captureLogger().logger));
    a.use(resolvePlatform(domains));
    a.get('/api/probe', (c) => c.json({ platform: c.get('platform') }));
    a.get('/api/health', (c) => c.json({ ok: true }));
    a.get('/api/health/ready', (c) => c.json({ ok: true }));
    a.get('/api/healthz', (c) => c.json({ ok: true }));
    return a;
  }

  it('puts the platform of the host on the context', async () => {
    const tree = await app().request('http://localhost:8080/api/probe');
    expect(await tree.json()).toEqual({ platform: 'treerepro' });
    const plant = await app().request('http://plantrepro.localhost:8080/api/probe');
    expect(await plant.json()).toEqual({ platform: 'plantrepro' });
  });

  it('answers 421 UNKNOWN_HOST for any other host, and for PlantRepro without a domain', async () => {
    for (const [url, domains] of [
      ['http://evil.example/api/probe', DEV],
      ['http://127.0.0.1:3000/api/probe', DEV],
      ['http://plantrepro.localhost/api/probe', { tree: 'localhost', plant: null }],
      ['http://127.0.0.1:3000/api/healthz', DEV],
    ] as const) {
      const res = await app(domains).request(url);
      expect(res.status, url).toBe(421);
      expect((await res.json()).error.code).toBe('UNKNOWN_HOST');
    }
  });

  it('exempts the health routes, whatever the host', async () => {
    for (const path of ['/api/health', '/api/health/ready']) {
      const res = await app().request(`http://127.0.0.1:3000${path}`);
      expect(res.status, path).toBe(200);
    }
  });
});

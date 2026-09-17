import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import { createReference } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

describe('RFC-61 R4 reference routes', () => {
  const t = useTestApp();

  it('lists with q and answers the detail or 404 REFERENCE_NOT_FOUND', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const ref = await createReference(t.db);
    const list = await call(
      t.app,
      'GET',
      `/api/references?q=${encodeURIComponent(ref.citationKey)}`,
      { cookie },
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      data: [expect.objectContaining({ id: ref.id, primaryCount: 0, secondaryCount: 0 })],
      meta: { nextCursor: null },
    });
    const detail = await call(t.app, 'GET', `/api/references/${ref.id}`, { cookie });
    expect((await detail.json()).data).toMatchObject({
      id: ref.id,
      recordCount: 0,
      primaryCount: 0,
      secondaryCount: 0,
    });
    const missing = await call(
      t.app,
      'GET',
      '/api/references/00000000-0000-7000-8000-000000000000',
      { cookie },
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('REFERENCE_NOT_FOUND');
  });
});

describe('RFC-61 R6 reference writes', () => {
  const t = useTestApp();

  async function librarian() {
    const role = await createRole(t.db, { permissions: ['references.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('creates with metadata, edits and clears fields, refuses duplicate keys and DOIs, audits fields', async () => {
    const { cookie } = await librarian();
    const k = Math.random().toString(16).slice(2);
    const created = await call(t.app, 'POST', '/api/references', {
      cookie,
      body: { citationKey: ` Doe_${k} `, title: 'On seeds', year: 2020, doi: `10.1/${k}` },
    });
    expect(created.status).toBe(201);
    const ref = (await created.json()).data;
    expect(ref).toMatchObject({
      citationKey: `Doe_${k}`,
      title: 'On seeds',
      year: 2020,
      doi: `10.1/${k}`,
      authors: null,
      primaryCount: 0,
      secondaryCount: 0,
      recordCount: 0,
    });
    expect((await lastAudit(t.db, 'references.created', { targetId: ref.id }))?.targetType).toBe(
      'bibliographic_references',
    );
    const dupKey = await call(t.app, 'POST', '/api/references', {
      cookie,
      body: { citationKey: `Doe_${k}` },
    });
    expect((await dupKey.json()).error.code).toBe('REFERENCE_KEY_TAKEN');
    const dupDoi = await call(t.app, 'POST', '/api/references', {
      cookie,
      body: { citationKey: `Roe_${k}`, doi: `10.1/${k}` },
    });
    expect((await dupDoi.json()).error.code).toBe('REFERENCE_DOI_TAKEN');
    const edited = await call(t.app, 'PATCH', `/api/references/${ref.id}`, {
      cookie,
      body: { authors: 'Doe, J.', doi: null, year: 2021 },
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).data).toMatchObject({ authors: 'Doe, J.', doi: null, year: 2021 });
    expect((await lastAudit(t.db, 'references.updated', { targetId: ref.id }))?.metadata).toEqual({
      fields: ['authors', 'year', 'doi'],
    });
    const badKey = await call(t.app, 'PATCH', `/api/references/${ref.id}`, {
      cookie,
      body: { citationKey: null },
    });
    expect(badKey.status).toBe(400);
    const missing = await call(
      t.app,
      'PATCH',
      '/api/references/00000000-0000-7000-8000-000000000000',
      { cookie, body: { title: 'x' } },
    );
    expect((await missing.json()).error.code).toBe('REFERENCE_NOT_FOUND');
  });
});

describe('RFC-80 R4 GET /api/references/resolve', () => {
  const t = useTestApp();

  async function contributor() {
    const role = await createRole(t.db, { permissions: ['records.create', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('answers known, resolvable (with preview), not_found, 400 on malformed, and 429 after 60 calls', async () => {
    const { cookie } = await contributor();
    const existing = await createReference(t.db, { doi: '10.1111/known' });

    // Known
    const resKnown = await call(
      t.app,
      'GET',
      `/api/references/resolve?doi=${encodeURIComponent(existing.doi!)}`,
      { cookie },
    );
    expect(resKnown.status).toBe(200);
    expect((await resKnown.json()).data).toMatchObject({
      status: 'known',
      reference: expect.objectContaining({ id: existing.id }),
    });

    // Resolvable
    t.doi.known.set('10.1111/resolvable', {
      title: 'Preview Title',
      authors: 'Preview Authors',
      year: 2024,
      journal: 'Preview Journal',
    });
    const resResolvable = await call(
      t.app,
      'GET',
      '/api/references/resolve?doi=10.1111/resolvable',
      { cookie },
    );
    expect(resResolvable.status).toBe(200);
    expect(await resResolvable.json()).toEqual({
      data: {
        status: 'resolvable',
        reference: null,
        preview: {
          title: 'Preview Title',
          authors: 'Preview Authors',
          year: 2024,
          journal: 'Preview Journal',
        },
      },
    });

    // Not found
    const resNotFound = await call(
      t.app,
      'GET',
      '/api/references/resolve?doi=10.1111/notfound',
      { cookie },
    );
    expect(resNotFound.status).toBe(200);
    expect(await resNotFound.json()).toEqual({
      data: { status: 'not_found', reference: null },
    });

    // Malformed DOI
    const resBad = await call(t.app, 'GET', '/api/references/resolve?doi=bad', { cookie });
    expect(resBad.status).toBe(400);

    // Rate limit: 60 calls allowed, 61st rejected with 429
    // (Already made 3 valid calls with this cookie: resKnown, resResolvable, resNotFound)
    for (let i = 0; i < 57; i++) {
      await call(t.app, 'GET', '/api/references/resolve?doi=10.1111/notfound', { cookie });
    }
    const limited = await call(t.app, 'GET', '/api/references/resolve?doi=10.1111/notfound', { cookie });
    expect(limited.status).toBe(429);
  });
});

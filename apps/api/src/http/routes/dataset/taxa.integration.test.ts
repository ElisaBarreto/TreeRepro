import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import { createFamily, createGenus } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

const rand = () => Math.random().toString(16).slice(2);
const zero = '00000000-0000-7000-8000-000000000000';

describe('RFC-60 R9, R10 family and genus writes', () => {
  const t = useTestApp();

  async function taxonomist() {
    const role = await createRole(t.db, { permissions: ['taxa.manage', 'dataset.read'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  it('creates and renames a family, normalises the name, refuses duplicates, audits with ids only', async () => {
    const { user, cookie } = await taxonomist();
    const name = `Testaceae-${rand()}`;
    const created = await call(t.app, 'POST', '/api/families', {
      cookie,
      body: { name: `  ${name}   x ` },
    });
    expect(created.status).toBe(201);
    const family = (await created.json()).data;
    expect(family).toEqual({ id: expect.any(String), name: `${name} x` });
    expect((await lastAudit(t.db, 'taxa.created', { targetId: family.id }))?.metadata).toEqual({
      kind: 'family',
    });
    const dup = await call(t.app, 'POST', '/api/families', { cookie, body: { name: `${name} x` } });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('FAMILY_NAME_TAKEN');
    const renamed = await call(t.app, 'PATCH', `/api/families/${family.id}`, {
      cookie,
      body: { name: `${name} y` },
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).data.name).toBe(`${name} y`);
    const audit = await lastAudit(t.db, 'taxa.updated', { targetId: family.id });
    expect(audit).toMatchObject({
      actorUserId: user.id,
      targetType: 'families',
      metadata: { kind: 'family', fields: ['name'] },
    });
    const noop = await call(t.app, 'PATCH', `/api/families/${family.id}`, {
      cookie,
      body: { name: `${name} y` },
    });
    expect(noop.status).toBe(200);
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: family.id }))?.id).toBe(audit?.id);
    const missing = await call(t.app, 'PATCH', `/api/families/${zero}`, {
      cookie,
      body: { name: 'x' },
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('FAMILY_NOT_FOUND');
    const empty = await call(t.app, 'PATCH', `/api/families/${family.id}`, { cookie, body: {} });
    expect(empty.status).toBe(400);
  });

  it('creates a genus in a family, moves and detaches it, refuses an unknown family', async () => {
    const { cookie } = await taxonomist();
    const f1 = await createFamily(t.db);
    const f2 = await createFamily(t.db);
    const created = await call(t.app, 'POST', '/api/genera', {
      cookie,
      body: { name: `Testus-${rand()}`, familyId: f1.id },
    });
    expect(created.status).toBe(201);
    const genus = (await created.json()).data;
    expect(genus).toMatchObject({ family: { id: f1.id, name: f1.name } });
    const moved = await call(t.app, 'PATCH', `/api/genera/${genus.id}`, {
      cookie,
      body: { familyId: f2.id },
    });
    expect((await moved.json()).data.family.id).toBe(f2.id);
    expect((await lastAudit(t.db, 'taxa.updated', { targetId: genus.id }))?.metadata).toEqual({
      kind: 'genus',
      fields: ['familyId'],
    });
    const detached = await call(t.app, 'PATCH', `/api/genera/${genus.id}`, {
      cookie,
      body: { familyId: null },
    });
    expect((await detached.json()).data.family).toBeNull();
    const unknown = await call(t.app, 'POST', '/api/genera', {
      cookie,
      body: { name: `Testus-${rand()}`, familyId: zero },
    });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('FAMILY_NOT_FOUND');
    const dup = await call(t.app, 'POST', '/api/genera', { cookie, body: { name: genus.name } });
    expect((await dup.json()).error.code).toBe('GENUS_NAME_TAKEN');
    const existing = await createGenus(t.db);
    const missing = await call(t.app, 'PATCH', `/api/genera/${zero}`, {
      cookie,
      body: { name: existing.name },
    });
    expect((await missing.json()).error.code).toBe('GENUS_NOT_FOUND');
  });
});

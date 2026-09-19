import { randomBytes } from 'node:crypto';
import type { Lookup } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { createSpecies } from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

const tag = () => randomBytes(6).toString('hex');

/** R-E: the open-proposal unique index is shared by every parallel suite. */
const aName = () => `Testus rogatus ${tag()}`;

const UNKNOWN_ID = '00000000-0000-7000-8000-000000000000';

const exactLookup = (name: string): Lookup => ({
  backbone: {
    matchType: 'EXACT',
    confidence: 98,
    usageKey: '2878688',
    scientificName: `${name} L.`,
    canonicalName: name,
    rank: 'SPECIES',
    status: 'ACCEPTED',
    family: 'Fagaceae',
    genus: 'Quercus',
    acceptedUsageKey: null,
    note: null,
  },
  wcvp: null,
  verdict: 'exact',
});

async function proposer(t: ReturnType<typeof useTestApp>) {
  const role = await createRole(t.db, { permissions: ['taxa.propose'] });
  const { user } = await createUser(t.db, { roles: [role.id] });
  return { user, cookie: (await loginAs(t, user)).cookie };
}

async function manager(t: ReturnType<typeof useTestApp>) {
  const role = await createRole(t.db, { permissions: ['taxa.manage', 'dataset.read'] });
  const { user } = await createUser(t.db, { roles: [role.id] });
  return { user, cookie: (await loginAs(t, user)).cookie };
}

describe('RFC-75 R2 POST /api/species/proposals', () => {
  const t = useTestApp();

  it('answers 201 with the proposal and its stored lookup', async () => {
    const who = await proposer(t);
    const name = aName();
    t.taxonomy.answers.set(name, exactLookup(name));

    const res = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name, note: 'Seen near the river' },
    });

    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      proposedName: name,
      note: 'Seen near the river',
      status: 'open',
      proposer: { id: who.user.id, name: 'Test User' },
      lookup: exactLookup(name),
    });
  });

  it('answers 409 SPECIES_NAME_TAKEN carrying the species id in details', async () => {
    const who = await proposer(t);
    const existing = await createSpecies(t.db);

    const res = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: existing.canonicalName },
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({
      code: 'SPECIES_NAME_TAKEN',
      details: [{ path: 'name', message: existing.id }],
    });
  });

  it('answers 409 PROPOSAL_EXISTS for a name already proposed and open', async () => {
    const who = await proposer(t);
    const name = aName();
    const first = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name },
    });
    const created = (await first.json()) as { data: { id: string } };

    const again = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: name.toLowerCase() },
    });

    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatchObject({
      code: 'PROPOSAL_EXISTS',
      details: [{ path: 'name', message: created.data.id }],
    });
  });

  it('refuses a viewer who only manages taxa: proposing needs taxa.propose', async () => {
    const who = await manager(t);
    const res = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: aName() },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('PERMISSION_DENIED');
  });
});

describe('RFC-75 R3 GET /api/species/proposals', () => {
  const t = useTestApp();

  it('is matched as a literal segment, not swallowed by /api/species/:id (R-M)', async () => {
    const who = await proposer(t);
    const boss = await manager(t);
    const name = aName();
    const created = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name },
    });
    const { data: mine } = (await created.json()) as { data: { id: string } };

    const res = await call(t.app, 'GET', '/api/species/proposals', { cookie: boss.cookie });

    // `/api/species/:id` would answer 400 VALIDATION_FAILED on the non-uuid
    // id "proposals"; the list answers 200 with a paged envelope.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[]; meta: unknown };
    expect(body.meta).toEqual({ nextCursor: null });
    expect(body.data.map((p) => p.id)).toContain(mine.id);
  });

  it('defaults to the open proposals when no status is given (R3)', async () => {
    const who = await proposer(t);
    const boss = await manager(t);
    const open = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: aName() },
    });
    const openId = ((await open.json()) as { data: { id: string } }).data.id;
    const decided = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: aName() },
    });
    const decidedId = ((await decided.json()) as { data: { id: string } }).data.id;
    const rejected = await call(t.app, 'POST', `/api/species/proposals/${decidedId}/reject`, {
      cookie: boss.cookie,
      body: { note: 'Already a synonym' },
    });
    expect(rejected.status).toBe(200);

    const res = await call(t.app, 'GET', '/api/species/proposals?limit=200', {
      cookie: boss.cookie,
    });
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((p) => p.id);
    expect(ids).toContain(openId);
    expect(ids).not.toContain(decidedId);

    const asked = await call(t.app, 'GET', '/api/species/proposals?status=rejected&limit=200', {
      cookie: boss.cookie,
    });
    const rejectedIds = ((await asked.json()) as { data: { id: string }[] }).data.map((p) => p.id);
    expect(rejectedIds).toContain(decidedId);
    expect(rejectedIds).not.toContain(openId);
  });

  it('answers the detail, and 404 PROPOSAL_NOT_FOUND for an unknown id', async () => {
    const who = await proposer(t);
    const boss = await manager(t);
    const created = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: aName() },
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;

    const detail = await call(t.app, 'GET', `/api/species/proposals/${id}`, {
      cookie: boss.cookie,
    });
    expect(detail.status).toBe(200);
    expect((await detail.json()).data).toMatchObject({ id, status: 'open' });

    const missing = await call(t.app, 'GET', `/api/species/proposals/${UNKNOWN_ID}`, {
      cookie: boss.cookie,
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('PROPOSAL_NOT_FOUND');
  });
});

describe('RFC-75 R4 decisions', () => {
  const t = useTestApp();

  it('approves, creating the species, and refuses a second decision with 409', async () => {
    const who = await proposer(t);
    const boss = await manager(t);
    const name = aName();
    const created = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name },
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;

    const approved = await call(t.app, 'POST', `/api/species/proposals/${id}/approve`, {
      cookie: boss.cookie,
      body: {
        canonicalName: name,
        nameSource: 'gbif',
        genusName: `Testus-${tag()}`,
        familyName: `Testaceae-${tag()}`,
      },
    });
    expect(approved.status).toBe(200);
    const body = (await approved.json()) as {
      data: { status: string; species: { id: string; canonicalName: string } };
    };
    expect(body.data.status).toBe('approved');
    expect(body.data.species.canonicalName).toBe(name);

    const species = await call(t.app, 'GET', `/api/species/${body.data.species.id}`, {
      cookie: boss.cookie,
    });
    expect(species.status).toBe(200);

    const again = await call(t.app, 'POST', `/api/species/proposals/${id}/reject`, {
      cookie: boss.cookie,
      body: { note: 'Changed my mind' },
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('PROPOSAL_DECIDED');
  });

  it('refuses a decision from a viewer who may only propose', async () => {
    const who = await proposer(t);
    const created = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: aName() },
    });
    const id = ((await created.json()) as { data: { id: string } }).data.id;

    const res = await call(t.app, 'POST', `/api/species/proposals/${id}/reject`, {
      cookie: who.cookie,
      body: { note: 'Mine' },
    });
    expect(res.status).toBe(403);
  });
});

describe('RFC-75 R5 GET /api/me/proposals', () => {
  const t = useTestApp();

  it("lists the viewer's own proposals in any status", async () => {
    const who = await proposer(t);
    const stranger = await proposer(t);
    const mine = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: who.cookie,
      body: { name: aName() },
    });
    const mineId = ((await mine.json()) as { data: { id: string } }).data.id;
    const theirs = await call(t.app, 'POST', '/api/species/proposals', {
      cookie: stranger.cookie,
      body: { name: aName() },
    });
    const theirsId = ((await theirs.json()) as { data: { id: string } }).data.id;

    const res = await call(t.app, 'GET', '/api/me/proposals', { cookie: who.cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[]; meta: unknown };
    expect(body.data.map((p) => p.id)).toEqual([mineId]);
    expect(body.data.map((p) => p.id)).not.toContain(theirsId);
    expect(body.meta).toEqual({ nextCursor: null });
  });
});

describe('RFC-81 R4 GET /api/taxonomy/match', () => {
  const t = useTestApp();

  it('answers the lookup to a viewer holding taxa.manage', async () => {
    const boss = await manager(t);
    const name = aName();
    t.taxonomy.answers.set(name, exactLookup(name));

    const res = await call(t.app, 'GET', `/api/taxonomy/match?name=${encodeURIComponent(name)}`, {
      cookie: boss.cookie,
    });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(exactLookup(name));
  });

  it('answers 502 TAXONOMY_LOOKUP_FAILED when every attempted call failed', async () => {
    const boss = await manager(t);
    t.taxonomy.failing = true;
    try {
      const res = await call(
        t.app,
        'GET',
        `/api/taxonomy/match?name=${encodeURIComponent(aName())}`,
        {
          cookie: boss.cookie,
        },
      );
      expect(res.status).toBe(502);
      expect((await res.json()).error.code).toBe('TAXONOMY_LOOKUP_FAILED');
    } finally {
      t.taxonomy.failing = false;
    }
  });

  it('refuses a viewer who may only propose', async () => {
    const who = await proposer(t);
    const res = await call(t.app, 'GET', '/api/taxonomy/match?name=Quercus%20robur', {
      cookie: who.cookie,
    });
    expect(res.status).toBe(403);
  });

  it('limits one user to 30 lookups a minute (RFC-24 R3)', async () => {
    const boss = await manager(t);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const res = await call(
        t.app,
        'GET',
        `/api/taxonomy/match?name=${encodeURIComponent(aName())}`,
        {
          cookie: boss.cookie,
        },
      );
      statuses.push(res.status);
      if (res.status === 429) {
        expect((await res.json()).error.code).toBe('RATE_LIMITED');
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      }
    }
    // The bucket is keyed by the user, and this user is fresh: exactly the
    // first 30 pass and the 31st is refused.
    expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 200));
    expect(statuses[30]).toBe(429);
  });
});

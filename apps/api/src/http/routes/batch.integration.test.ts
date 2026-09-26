import { and, eq, isNotNull, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAdminKey } from '../../../test/helpers/api-keys.ts';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import {
  createImportBatch,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../../test/helpers/dataset.ts';
import { adminRoleId } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import { traitRecords } from '../../db/schema/records.ts';
import { families } from '../../db/schema/taxa.ts';

const ZERO = '00000000-0000-0000-0000-000000000000';
const rand = () => Math.random().toString(36).slice(2, 8);

describe('RFC-82 R10-R15 POST /api/batch', () => {
  const t = useTestApp();
  const batch = (headers: Record<string, string>, ops: unknown[]) =>
    call(t.app, 'POST', '/api/batch', { headers, origin: null, body: { ops } });

  it('R10 refuses a cookie session and an anonymous caller with 401', async () => {
    const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const { cookie } = await loginAs(t, user);
    const ops = [{ method: 'GET', path: '/api/families' }];
    const withCookie = await call(t.app, 'POST', '/api/batch', { cookie, body: { ops } });
    expect(withCookie.status).toBe(401);
    expect((await withCookie.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
    const anonymous = await call(t.app, 'POST', '/api/batch', { body: { ops } });
    expect(anonymous.status).toBe(401);
  });

  it('R10 refuses an empty batch, more than 500 operations and unknown fields with 400', async () => {
    const { headers } = await createAdminKey(t);
    const op = { method: 'GET', path: '/api/families' };
    for (const ops of [[], Array(501).fill(op), [{ ...op, extra: true }]]) {
      const res = await batch(headers, ops);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('R11, R13 runs in order, keeps going past a failure and answers what each route answers', async () => {
    const { user, key, headers } = await createAdminKey(t);
    const name = `Batchaceae-${rand()}`;
    const res = await batch(headers, [
      { ref: 'a', method: 'POST', path: '/api/families', body: { name } },
      { ref: 'b', method: 'POST', path: '/api/families', body: {} },
      { method: 'POST', path: '/api/families', body: { name } },
      { ref: 'd', method: 'GET', path: `/api/records/${ZERO}` },
    ]);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.summary).toEqual({ ok: 1, failed: 3 });
    expect(data.results.map((r: { ref: string | null }) => r.ref)).toEqual(['a', 'b', null, 'd']);
    expect(data.results.map((r: { status: number }) => r.status)).toEqual([201, 400, 409, 404]);
    expect(data.results[0].body.data).toEqual({ id: expect.any(String), name });
    expect(data.results[1].body.error.code).toBe('VALIDATION_FAILED');
    // R15: the duplicate answers exactly the single-call duplicate error.
    expect(data.results[2].body.error.code).toBe('FAMILY_NAME_TAKEN');
    const direct = await call(t.app, 'GET', `/api/records/${ZERO}`, { headers, origin: null });
    expect(data.results[3].body).toEqual(await direct.json());
    // R11: same audit and authorship as a single call made with the key.
    expect(
      await lastAudit(t.db, 'taxa.created', { targetId: data.results[0].body.data.id }),
    ).toMatchObject({ actorUserId: user.id, metadata: { via: 'api_key', apiKeyId: key.id } });
  });

  it('R11, R15 maps a pending group with the key owner as author; re-sending creates nothing', async () => {
    const { user, headers } = await createAdminKey(t);
    const species = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['red', 'blue'] });
    const ref = await createReference(t.db);
    const importBatch = await createImportBatch(t.db);
    const pending = [];
    for (let i = 0; i < 2; i++) {
      pending.push(
        await createRecord(t.db, {
          speciesId: species.id,
          traitId: trait.id,
          valueText: 'reds',
          // Distinct raw values: two identical claims would break the unique claim key.
          rawValue: `reds ${i}`,
          primaryReferenceId: ref.id,
          importBatchId: importBatch.id,
          harmonisation: 'unknown_level',
        }),
      );
    }
    const red = trait.levels[0]?.id ?? '';
    const ops = [
      {
        method: 'POST',
        path: '/api/records/pending/map',
        body: { traitId: trait.id, valueText: 'reds', value: { levelIds: [red] } },
      },
    ];
    const first = await (await batch(headers, ops)).json();
    expect(first.data.results[0]).toMatchObject({ status: 200, body: { data: { created: 2 } } });
    const mapped = await t.db
      .select({ createdBy: traitRecords.createdBy })
      .from(traitRecords)
      .where(and(eq(traitRecords.traitId, trait.id), isNotNull(traitRecords.supersedesRecordId)));
    expect(mapped).toEqual([{ createdBy: user.id }, { createdBy: user.id }]);
    await batch(headers, ops);
    const after = await t.db
      .select({ id: traitRecords.id })
      .from(traitRecords)
      .where(eq(traitRecords.traitId, trait.id));
    expect(after).toHaveLength(4);
  });

  it('R12 refuses forbidden paths per item and still runs the rest', async () => {
    const { headers } = await createAdminKey(t);
    const refused = [
      { method: 'GET', path: '/health' },
      { method: 'GET', path: 'api/families' },
      { method: 'GET', path: '//evil.test/api/families' },
      { method: 'GET', path: '/api/../auth/me' },
      { method: 'GET', path: '/api/%2e%2e/api/auth/me' },
      { method: 'POST', path: '/api/batch', body: { ops: [] } },
      { method: 'GET', path: '/api/auth/me' },
      { method: 'GET', path: '/api/auth/m%65' },
      { method: 'POST', path: '/api/b%61tch', body: { ops: [] } },
      { method: 'GET', path: '/api/families/%E0%A4%A' },
      { method: 'POST', path: '/api/me/api-keys', body: {} },
      { method: 'DELETE', path: `/api/me/sessions/${ZERO}` },
      { method: 'GET', path: '/api/help/some-slug' },
      { method: 'GET', path: '/api/families', body: {} },
    ];
    const res = await batch(headers, [...refused, { method: 'GET', path: '/api/families' }]);
    const { data } = await res.json();
    expect(data.summary).toEqual({ ok: 1, failed: refused.length });
    for (const result of data.results.slice(0, refused.length)) {
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(data.results.at(-1).status).toBe(200);
  });

  it('R13 gives body null for a response that is not JSON', async () => {
    const { headers } = await createAdminKey(t);
    // The export streams a ZIP (RFC-66); the admin key holds `dataset.export`.
    const res = await batch(headers, [{ method: 'GET', path: '/api/export/dataset.zip' }]);
    const { data } = await res.json();
    expect(data.results[0]).toEqual({ ref: null, status: 200, body: null });
    expect(data.summary).toEqual({ ok: 1, failed: 0 });
  });

  it('R14 a batch of n costs n units and is refused whole when they do not fit', async () => {
    const { key, headers } = await createAdminKey(t);
    const bucket = `rl:global:api_key:${key.id}`;
    const name = `Limitaceae-${rand()}`;
    const ops = [0, 1, 2].map((i) => ({
      method: 'POST',
      path: '/api/families',
      body: { name: `${name}-${i}` },
    }));
    expect((await batch(headers, ops)).status).toBe(200);
    expect(await t.redis.zcard(bucket)).toBe(3);

    // Leave 3 units: a 4-operation batch pays 1 for its call, then lacks 1.
    const { limit } = RATE_LIMITS.apiKey;
    await t.limiter.hit('global:api_key', key.id, RATE_LIMITS.apiKey, limit - 6);
    const refused = await batch(headers, [
      ...[0, 1, 2].map((i) => ({
        method: 'POST',
        path: '/api/families',
        body: { name: `${name}-late-${i}` },
      })),
      { method: 'GET', path: '/api/families' },
    ]);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe('RATE_LIMITED');
    // The refused batch created nothing. Checked in the database, not through
    // the API, so no unit is spent between the two batches.
    const late = await t.db
      .select({ id: families.id })
      .from(families)
      .where(like(families.name, `${name}-late-%`));
    expect(late).toEqual([]);
    // The refused call cost 1: 2 units left, and a 2-operation batch fits exactly.
    const fits = await batch(headers, [
      { method: 'GET', path: '/api/families' },
      { method: 'GET', path: '/api/families' },
    ]);
    expect(fits.status).toBe(200);
    expect(await t.redis.zcard(bucket)).toBe(limit);
  });
});

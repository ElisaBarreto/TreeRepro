import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TEST_KEYRING } from '../../test/helpers/pii.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import { decryptPii } from '../security/pii.ts';
import {
  createSessionStore,
  deriveKeyId,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './sessions.ts';

const SECRET = Buffer.alloc(32, 9);

describe('RFC-22 R4, R6 session store', () => {
  let redis: Redis;
  const clock = { now: Date.parse('2026-09-12T10:00:00Z') };
  const uid = () => `user-${Math.random().toString(16).slice(2)}`;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('creates a record under the HMAC key with encrypted ip and user agent', async () => {
    const store = createSessionStore(redis, SECRET, () => clock.now);
    const userId = uid();
    const { rawId, record } = await store.create({ userId, ip: '203.0.113.7', userAgent: 'UA/1' });
    expect(record.id).toBe(deriveKeyId(SECRET, rawId));
    expect(await redis.exists(`session:${rawId}`)).toBe(0);
    const raw = await redis.hgetall(`session:${record.id}`);
    expect(raw.userId).toBe(userId);
    expect(raw.ip).not.toBe('203.0.113.7');
    expect(decryptPii(TEST_KEYRING, raw.ip ?? '', 'session.ip')).toBe('203.0.113.7');
    expect(decryptPii(TEST_KEYRING, raw.userAgent ?? '', 'session.userAgent')).toBe('UA/1');
    const ttl = await redis.pttl(`session:${record.id}`);
    expect(ttl).toBeGreaterThan(SESSION_IDLE_TTL_MS - 5000);
    expect(await redis.sismember(`user_sessions:${userId}`, record.id)).toBe(1);
    const got = await store.get(rawId);
    expect(got).toEqual({ ...record, ip: '203.0.113.7', userAgent: 'UA/1' });
  });

  it('returns null for unknown ids and refreshes the idle TTL at most once a minute', async () => {
    const store = createSessionStore(redis, SECRET, () => clock.now);
    expect(await store.get('A'.repeat(43))).toBeNull();
    const { rawId, record } = await store.create({ userId: uid(), ip: '1.1.1.1', userAgent: 'x' });
    await redis.pexpire(`session:${record.id}`, 1000);
    clock.now += SESSION_TOUCH_INTERVAL_MS - 1;
    await store.get(rawId);
    expect(await redis.pttl(`session:${record.id}`)).toBeLessThanOrEqual(1000);
    clock.now += 2;
    const touched = await store.get(rawId);
    expect(touched?.lastSeenAt).toBe(clock.now);
    expect(await redis.pttl(`session:${record.id}`)).toBeGreaterThan(SESSION_IDLE_TTL_MS - 5000);
  });

  it('deletes a session at exactly the absolute limit', async () => {
    const store = createSessionStore(redis, SECRET, () => clock.now);
    const userId = uid();
    const { rawId, record } = await store.create({ userId, ip: '1.1.1.1', userAgent: 'x' });
    clock.now += SESSION_ABSOLUTE_TTL_MS;
    expect(await store.get(rawId)).toBeNull();
    expect(await redis.exists(`session:${record.id}`)).toBe(0);
    expect(await redis.sismember(`user_sessions:${userId}`, record.id)).toBe(0);
  });

  it('lists, revokes one and revokes all except the current', async () => {
    const store = createSessionStore(redis, SECRET, () => clock.now);
    const userId = uid();
    const a = await store.create({ userId, ip: '1.1.1.1', userAgent: 'a' });
    clock.now += 10;
    const b = await store.create({ userId, ip: '2.2.2.2', userAgent: 'b' });
    clock.now += 10;
    const c = await store.create({ userId, ip: '3.3.3.3', userAgent: 'c' });
    expect((await store.list(userId)).map((s) => s.userAgent)).toEqual(['c', 'b', 'a']);
    expect(await store.revoke(b.record.id)).toBe(true);
    expect(await store.revoke(b.record.id)).toBe(false);
    expect(await store.get(b.rawId)).toBeNull();
    expect(await store.revokeAll(userId, c.record.id)).toBe(1);
    expect(await store.get(a.rawId)).toBeNull();
    expect(await store.get(c.rawId)).not.toBeNull();
    expect(await store.revokeAll(userId)).toBe(1);
    expect(await store.list(userId)).toEqual([]);
  });

  it('list prunes index members whose record expired', async () => {
    const store = createSessionStore(redis, SECRET, () => clock.now);
    const userId = uid();
    const { record } = await store.create({ userId, ip: '1.1.1.1', userAgent: 'x' });
    await redis.del(`session:${record.id}`);
    expect(await store.list(userId)).toEqual([]);
    expect(await redis.scard(`user_sessions:${userId}`)).toBe(0);
  });
});

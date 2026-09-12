import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TEST_KEYRING } from '../../test/helpers/pii.ts';
import { createRedis, type Redis } from '../redis/client.ts';
import { decryptPii } from '../security/pii.ts';
import {
  createMfaStore,
  MFA_CHALLENGE_TTL_MS,
  MFA_MAX_ATTEMPTS,
  TOTP_REPLAY_TTL_MS,
} from './mfa.ts';
import { deriveKeyId } from './sessions.ts';

const SECRET = Buffer.alloc(32, 5);

describe('RFC-23 R6 MFA challenge store', () => {
  let redis: Redis;
  const uid = () => `user-${Math.random().toString(16).slice(2)}`;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('creates a challenge under the HMAC key with a 5 minute TTL and zero attempts', async () => {
    const store = createMfaStore(redis, SECRET);
    const userId = uid();
    const { rawId, id } = await store.createChallenge(userId);
    expect(id).toBe(deriveKeyId(SECRET, rawId));
    expect(await store.getChallenge(rawId)).toEqual({ id, userId, attempts: 0 });
    const ttl = await redis.pttl(`mfa:${id}`);
    expect(ttl).toBeGreaterThan(MFA_CHALLENGE_TTL_MS - 5000);
    expect(await store.getChallenge('B'.repeat(43))).toBeNull();
  });

  it('counts failures and expires the challenge on the third', async () => {
    const store = createMfaStore(redis, SECRET);
    const { rawId } = await store.createChallenge(uid());
    expect(await store.recordFailure(rawId)).toBe('retry');
    expect(await store.recordFailure(rawId)).toBe('retry');
    expect((await store.getChallenge(rawId))?.attempts).toBe(2);
    expect(await store.recordFailure(rawId)).toBe('expired');
    expect(await store.getChallenge(rawId)).toBeNull();
    expect(await store.recordFailure(rawId)).toBe('expired');
    expect(MFA_MAX_ATTEMPTS).toBe(3);
  });

  it('deleteChallenge removes it', async () => {
    const store = createMfaStore(redis, SECRET);
    const { rawId } = await store.createChallenge(uid());
    await store.deleteChallenge(rawId);
    expect(await store.getChallenge(rawId)).toBeNull();
  });
});

describe('RFC-23 R2 provisional setup secret', () => {
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('is stored encrypted for 10 minutes and deleted on demand', async () => {
    const store = createMfaStore(redis, SECRET);
    const userId = `user-${Math.random().toString(16).slice(2)}`;
    await store.putSetupSecret(userId, 'JBSWY3DPEHPK3PXP');
    const raw = await redis.get(`totp_setup:${userId}`);
    expect(raw).not.toBe('JBSWY3DPEHPK3PXP');
    expect(decryptPii(TEST_KEYRING, raw ?? '', 'totp_setup.secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(await redis.pttl(`totp_setup:${userId}`)).toBeGreaterThan(10 * 60 * 1000 - 5000);
    expect(await store.getSetupSecret(userId)).toBe('JBSWY3DPEHPK3PXP');
    await store.deleteSetupSecret(userId);
    expect(await store.getSetupSecret(userId)).toBeNull();
  });
});

describe('RFC-23 R4 replay guard', () => {
  let redis: Redis;
  beforeAll(async () => {
    redis = createRedis(inject('redisUrl'));
    await redis.connect();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('claims a counter once and rejects equal or older counters', async () => {
    const store = createMfaStore(redis, SECRET);
    const userId = `user-${Math.random().toString(16).slice(2)}`;
    expect(await store.claimTotpCounter(userId, 100)).toBe(true);
    expect(await store.claimTotpCounter(userId, 100)).toBe(false);
    expect(await store.claimTotpCounter(userId, 99)).toBe(false);
    expect(await store.claimTotpCounter(userId, 101)).toBe(true);
    expect(await redis.pttl(`totp_last:${userId}`)).toBeGreaterThan(TOTP_REPLAY_TTL_MS - 5000);
  });
});

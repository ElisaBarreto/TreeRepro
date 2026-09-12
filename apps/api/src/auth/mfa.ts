import type { Redis } from '../redis/client.ts';
import { getPii } from '../security/pii.ts';
import { deriveKeyId, generateRawId } from './sessions.ts';

/** @rfc RFC-23 R6 */
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** @rfc RFC-23 R6 */
export const MFA_MAX_ATTEMPTS = 3;
/** @rfc RFC-23 R2 */
export const TOTP_SETUP_TTL_MS = 10 * 60 * 1000;
/** @rfc RFC-23 R4 */
export const TOTP_REPLAY_TTL_MS = 90 * 1000;

const AAD_SETUP = 'totp_setup.secret';

export interface MfaChallenge {
  id: string;
  userId: string;
  attempts: number;
}

export interface MfaStore {
  createChallenge(userId: string): Promise<{ rawId: string; id: string }>;
  /** HMAC form of a raw cookie value, whether or not a challenge exists (RFC-24 R3, R7). */
  challengeId(rawId: string): string;
  getChallenge(rawId: string): Promise<MfaChallenge | null>;
  /** Increments attempts; deletes the challenge on the last allowed failure. */
  recordFailure(rawId: string): Promise<'retry' | 'expired'>;
  deleteChallenge(rawId: string): Promise<void>;
  putSetupSecret(userId: string, secret: string): Promise<void>;
  getSetupSecret(userId: string): Promise<string | null>;
  deleteSetupSecret(userId: string): Promise<void>;
  /** True when `counter` is newer than the last accepted one (replay guard). */
  claimTotpCounter(userId: string, counter: number): Promise<boolean>;
}

const CLAIM_SCRIPT = `
local last = tonumber(redis.call('GET', KEYS[1]) or '-1')
if tonumber(ARGV[1]) <= last then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;

// Existence check, increment and deletion in one step, so a challenge that
// expires mid-call is never recreated without a TTL. Returns -1 when absent.
const FAIL_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[1]) then redis.call('DEL', KEYS[1]) end
return attempts
`;

const challengeKey = (id: string) => `mfa:${id}`;
const setupKey = (userId: string) => `totp_setup:${userId}`;
const replayKey = (userId: string) => `totp_last:${userId}`;

/** @rfc RFC-23 R2, R4, R6 */
export function createMfaStore(redis: Redis, secret: Buffer): MfaStore {
  return {
    async createChallenge(userId) {
      const rawId = generateRawId();
      const id = deriveKeyId(secret, rawId);
      await redis
        .multi()
        .hset(challengeKey(id), { userId, attempts: '0' })
        .pexpire(challengeKey(id), MFA_CHALLENGE_TTL_MS)
        .exec();
      return { rawId, id };
    },

    challengeId(rawId) {
      return deriveKeyId(secret, rawId);
    },

    async getChallenge(rawId) {
      const id = deriveKeyId(secret, rawId);
      const raw = await redis.hgetall(challengeKey(id));
      if (!raw.userId) return null;
      return { id, userId: raw.userId, attempts: Number(raw.attempts ?? '0') };
    },

    async recordFailure(rawId) {
      const attempts = Number(
        await redis.eval(
          FAIL_SCRIPT,
          1,
          challengeKey(deriveKeyId(secret, rawId)),
          String(MFA_MAX_ATTEMPTS),
        ),
      );
      return attempts < 0 || attempts >= MFA_MAX_ATTEMPTS ? 'expired' : 'retry';
    },

    async deleteChallenge(rawId) {
      await redis.del(challengeKey(deriveKeyId(secret, rawId)));
    },

    async putSetupSecret(userId, totpSecret) {
      await redis.set(
        setupKey(userId),
        getPii().encrypt(totpSecret, AAD_SETUP),
        'PX',
        TOTP_SETUP_TTL_MS,
      );
    },

    async getSetupSecret(userId) {
      const raw = await redis.get(setupKey(userId));
      return raw ? getPii().decrypt(raw, AAD_SETUP) : null;
    },

    async deleteSetupSecret(userId) {
      await redis.del(setupKey(userId));
    },

    async claimTotpCounter(userId, counter) {
      const result = await redis.eval(
        CLAIM_SCRIPT,
        1,
        replayKey(userId),
        String(counter),
        String(TOTP_REPLAY_TTL_MS),
      );
      return result === 1;
    },
  };
}

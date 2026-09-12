import { createHmac, randomBytes } from 'node:crypto';
import type { Redis } from '../redis/client.ts';
import { getPii } from '../security/pii.ts';

/** @rfc RFC-22 R6 */
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
/** @rfc RFC-22 R6 */
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** @rfc RFC-22 R6 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

const AAD_IP = 'session.ip';
const AAD_UA = 'session.userAgent';

export interface SessionRecord {
  /** HMAC form of the raw id; safe to expose (RFC-22 R4). */
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  ip: string;
  userAgent: string;
}

export interface SessionStore {
  create(input: { userId: string; ip: string; userAgent: string }): Promise<{
    rawId: string;
    record: SessionRecord;
  }>;
  /** Resolves a cookie value; enforces both lifetimes and touches the record. */
  get(rawId: string): Promise<SessionRecord | null>;
  /** Revokes by HMAC id. Returns false when nothing existed. */
  revoke(id: string): Promise<boolean>;
  /** Revokes every session of the user except `exceptId`; returns the count. */
  revokeAll(userId: string, exceptId?: string): Promise<number>;
  /** Most recently seen first. */
  list(userId: string): Promise<SessionRecord[]>;
}

/** @rfc RFC-22 R4 */
export function generateRawId(): string {
  return randomBytes(32).toString('base64url');
}

/** @rfc RFC-22 R4 */
export function deriveKeyId(secret: Buffer, rawId: string): string {
  return createHmac('sha256', secret).update(rawId, 'utf8').digest('hex');
}

const sessionKey = (id: string) => `session:${id}`;
const indexKey = (userId: string) => `user_sessions:${userId}`;

function parse(id: string, raw: Record<string, string>): SessionRecord | null {
  if (!raw.userId || !raw.createdAt || !raw.lastSeenAt) return null;
  const pii = getPii();
  return {
    id,
    userId: raw.userId,
    createdAt: Number(raw.createdAt),
    lastSeenAt: Number(raw.lastSeenAt),
    ip: pii.decrypt(raw.ip ?? '', AAD_IP),
    userAgent: pii.decrypt(raw.userAgent ?? '', AAD_UA),
  };
}

/** @rfc RFC-22 R4, R6, R11 */
export function createSessionStore(
  redis: Redis,
  secret: Buffer,
  now: () => number = Date.now,
): SessionStore {
  async function drop(id: string, userId: string): Promise<void> {
    await redis.multi().del(sessionKey(id)).srem(indexKey(userId), id).exec();
  }

  return {
    async create(input) {
      const rawId = generateRawId();
      const id = deriveKeyId(secret, rawId);
      const t = now();
      const pii = getPii();
      await redis
        .multi()
        .hset(sessionKey(id), {
          userId: input.userId,
          createdAt: String(t),
          lastSeenAt: String(t),
          ip: pii.encrypt(input.ip, AAD_IP),
          userAgent: pii.encrypt(input.userAgent, AAD_UA),
        })
        .pexpire(sessionKey(id), SESSION_IDLE_TTL_MS)
        .sadd(indexKey(input.userId), id)
        .exec();
      return {
        rawId,
        record: {
          id,
          userId: input.userId,
          createdAt: t,
          lastSeenAt: t,
          ip: input.ip,
          userAgent: input.userAgent,
        },
      };
    },

    async get(rawId) {
      const id = deriveKeyId(secret, rawId);
      const record = parse(id, await redis.hgetall(sessionKey(id)));
      if (!record) return null;
      const t = now();
      if (t - record.createdAt >= SESSION_ABSOLUTE_TTL_MS) {
        await drop(id, record.userId);
        return null;
      }
      if (t - record.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS) {
        await redis
          .multi()
          .hset(sessionKey(id), { lastSeenAt: String(t) })
          .pexpire(sessionKey(id), SESSION_IDLE_TTL_MS)
          .exec();
        record.lastSeenAt = t;
      }
      return record;
    },

    async revoke(id) {
      const userId = await redis.hget(sessionKey(id), 'userId');
      if (!userId) return false;
      await drop(id, userId);
      return true;
    },

    async revokeAll(userId, exceptId) {
      const ids = (await redis.smembers(indexKey(userId))).filter((id) => id !== exceptId);
      if (ids.length === 0) return 0;
      const multi = redis.multi();
      for (const id of ids) multi.del(sessionKey(id)).srem(indexKey(userId), id);
      await multi.exec();
      return ids.length;
    },

    async list(userId) {
      const ids = await redis.smembers(indexKey(userId));
      if (ids.length === 0) return [];
      const pipeline = redis.pipeline();
      for (const id of ids) pipeline.hgetall(sessionKey(id));
      const results = (await pipeline.exec()) ?? [];
      const records: SessionRecord[] = [];
      const stale: string[] = [];
      ids.forEach((id, i) => {
        const record = parse(id, (results[i]?.[1] as Record<string, string>) ?? {});
        if (record) records.push(record);
        else stale.push(id);
      });
      if (stale.length > 0) await redis.srem(indexKey(userId), ...stale);
      return records.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    },
  };
}

import { and, eq, isNull, sql } from 'drizzle-orm';
import { describe, expect, inject, it } from 'vitest';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createDb } from '../db/client.ts';
import { authTokens } from '../db/schema/auth-tokens.ts';
import { users } from '../db/schema/users.ts';
import { getPii } from '../security/pii.ts';
import { consumeToken, hashToken, issueToken } from './tokens.ts';

async function newUser(tx: Parameters<Parameters<typeof withRollback>[1]>[0]): Promise<string> {
  const email = `t-${Math.random().toString(16).slice(2)}@example.test`;
  const [row] = await tx
    .insert(users)
    .values({ email, emailHash: getPii().blindIndex(email), name: 'T' })
    .returning();
  return row?.id ?? '';
}

describe('RFC-20 R5 issueToken / consumeToken', () => {
  const t = useTestDb();

  it('stores only the hash and redeems a token exactly once', async () => {
    await withRollback(t.db, async (tx) => {
      const userId = await newUser(tx);
      const now = new Date('2026-09-12T10:00:00Z');
      const { raw, expiresAt } = await issueToken(tx, { userId, kind: 'invite', now });
      expect(expiresAt.getTime() - now.getTime()).toBe(72 * 3600 * 1000);
      const [row] = await tx.select().from(authTokens).where(eq(authTokens.userId, userId));
      expect(row?.tokenHash).toBe(hashToken(raw));
      expect(JSON.stringify(row)).not.toContain(raw);
      expect(await consumeToken(tx, { raw, kind: 'invite', now })).toEqual({ userId });
      expect(await consumeToken(tx, { raw, kind: 'invite', now })).toBeNull();
    });
  });

  it('rejects the wrong kind, an expired token and an unknown token', async () => {
    await withRollback(t.db, async (tx) => {
      const userId = await newUser(tx);
      const now = new Date('2026-09-12T10:00:00Z');
      const { raw } = await issueToken(tx, { userId, kind: 'password_reset', now });
      expect(await consumeToken(tx, { raw, kind: 'invite', now })).toBeNull();
      const later = new Date(now.getTime() + 3600 * 1000 + 1);
      expect(await consumeToken(tx, { raw, kind: 'password_reset', now: later })).toBeNull();
      expect(
        await consumeToken(tx, { raw: 'A'.repeat(43), kind: 'password_reset', now }),
      ).toBeNull();
    });
  });

  it('issuing again consumes the previous token of the same kind only', async () => {
    await withRollback(t.db, async (tx) => {
      const userId = await newUser(tx);
      const first = await issueToken(tx, { userId, kind: 'invite' });
      const reset = await issueToken(tx, { userId, kind: 'password_reset' });
      const second = await issueToken(tx, { userId, kind: 'invite' });
      expect(await consumeToken(tx, { raw: first.raw, kind: 'invite' })).toBeNull();
      expect(await consumeToken(tx, { raw: second.raw, kind: 'invite' })).toEqual({ userId });
      expect(await consumeToken(tx, { raw: reset.raw, kind: 'password_reset' })).toEqual({
        userId,
      });
    });
  });

  it('RFC-20 R5 concurrent issuance leaves exactly one active token', async () => {
    const email = `t-${Math.random().toString(16).slice(2)}@example.test`;
    const [user] = await t.db
      .insert(users)
      .values({ email, emailHash: getPii().blindIndex(email), name: 'T' })
      .returning({ id: users.id });
    const userId = user?.id ?? '';
    // One connection per transaction, so all three really run at the same time.
    const pool = createDb(inject('databaseUrl'), { max: 3 });
    try {
      await Promise.all(
        [1, 2, 3].map(() =>
          pool.db.transaction((tx) => issueToken(tx, { userId, kind: 'invite' })),
        ),
      );
      const [active] = await t.db
        .select({ count: sql<number>`count(*)::int` })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.userId, userId),
            eq(authTokens.kind, 'invite'),
            isNull(authTokens.consumedAt),
          ),
        );
      const [total] = await t.db
        .select({ count: sql<number>`count(*)::int` })
        .from(authTokens)
        .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, 'invite')));
      expect(active?.count).toBe(1);
      expect(total?.count).toBe(3);
    } finally {
      await pool.close();
      await t.db.delete(authTokens).where(eq(authTokens.userId, userId));
      await t.db.delete(users).where(eq(users.id, userId));
    }
  });
});

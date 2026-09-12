import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { TEST_KEYRING } from '../../../test/helpers/pii.ts';
import { decryptPii, getPii } from '../../security/pii.ts';
import { auditLog } from './audit-log.ts';
import { authTokens } from './auth-tokens.ts';
import { totpRecoveryCodes } from './totp-recovery-codes.ts';
import { users } from './users.ts';

const email = () => `u-${Math.random().toString(16).slice(2)}@example.test`;

describe('RFC-20 R1 users table', () => {
  const t = useTestDb();

  it('stores email, name and totp_secret encrypted and defaults status to invited', async () => {
    await withRollback(t.db, async (tx) => {
      const e = email();
      const [row] = await tx
        .insert(users)
        .values({
          email: e,
          emailHash: getPii().blindIndex(e),
          name: 'Ada',
          totpSecret: 'JBSWY3DP',
        })
        .returning();
      expect(row?.status).toBe('invited');
      expect(row?.passwordHash).toBeNull();
      const raw = await tx.execute(
        sql`select email, name, totp_secret from users where id = ${row?.id}`,
      );
      const stored = raw[0] as { email: string; name: string; totp_secret: string };
      expect(stored.email).not.toContain('@');
      expect(decryptPii(TEST_KEYRING, stored.email, 'users.email')).toBe(e);
      expect(decryptPii(TEST_KEYRING, stored.name, 'users.name')).toBe('Ada');
      expect(decryptPii(TEST_KEYRING, stored.totp_secret, 'users.totp_secret')).toBe('JBSWY3DP');
    });
  });

  it('R3 email_hash is unique', async () => {
    await withRollback(t.db, async (tx) => {
      const e = email();
      const value = { email: e, emailHash: getPii().blindIndex(e), name: 'Ada' };
      await tx.insert(users).values(value);
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.insert(users).values(value))),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('R1 rejects an unknown status', async () => {
    await withRollback(t.db, async (tx) => {
      const e = email();
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(users).values({
              email: e,
              emailHash: getPii().blindIndex(e),
              name: 'Ada',
              status: 'weird' as never,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('R9 audit_log.actor_user_id must reference an existing user', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(auditLog).values({
              actorUserId: '019b4a2e-5f3c-7c8e-8d1a-2f3b4c5d6e7f',
              action: 'auth.logout',
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });
});

describe('RFC-20 R5 auth_tokens and RFC-23 R5 totp_recovery_codes', () => {
  const t = useTestDb();

  it('token_hash and code_hash are unique; kind is checked', async () => {
    await withRollback(t.db, async (tx) => {
      const e = email();
      const [user] = await tx
        .insert(users)
        .values({ email: e, emailHash: getPii().blindIndex(e), name: 'Ada' })
        .returning();
      const userId = user?.id ?? '';
      const token = { userId, kind: 'invite' as const, tokenHash: 'h1', expiresAt: new Date() };
      await tx.insert(authTokens).values(token);
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.insert(authTokens).values(token))),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.insert(authTokens).values({ ...token, tokenHash: 'h2', kind: 'other' as never }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await tx.insert(totpRecoveryCodes).values({ userId, codeHash: 'c1' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) => sp.insert(totpRecoveryCodes).values({ userId, codeHash: 'c1' })),
        ),
      ).rejects.toMatchObject({ code: '23505' });
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(totpRecoveryCodes)
        .where(eq(totpRecoveryCodes.userId, userId));
      expect(count?.n).toBe(1);
    });
  });
});

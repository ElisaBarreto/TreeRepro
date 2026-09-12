import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '../db/client.ts';
import { type AuthTokenKind, authTokens } from '../db/schema/auth-tokens.ts';

const HOUR_MS = 60 * 60 * 1000;

/** @rfc RFC-20 R5 */
export const TOKEN_TTL_MS: Record<AuthTokenKind, number> = {
  invite: 72 * HOUR_MS,
  password_reset: HOUR_MS,
};

/** @rfc RFC-20 R5 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** @rfc RFC-20 R5 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Must run inside a transaction; takes a per-user, per-kind advisory lock so
 * concurrent issuance cannot leave two unconsumed tokens.
 * @rfc RFC-20 R5
 */
export async function issueToken(
  db: DbTransaction,
  input: { userId: string; kind: AuthTokenKind; now?: Date },
): Promise<{ raw: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.kind}:${input.userId}`}))`);
  await db
    .update(authTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTokens.userId, input.userId),
        eq(authTokens.kind, input.kind),
        isNull(authTokens.consumedAt),
      ),
    );
  const raw = generateToken();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS[input.kind]);
  await db.insert(authTokens).values({
    userId: input.userId,
    kind: input.kind,
    tokenHash: hashToken(raw),
    expiresAt,
    createdAt: now,
  });
  return { raw, expiresAt };
}

/** One statement, so a token is redeemed at most once. @rfc RFC-20 R5 */
export async function consumeToken(
  db: DbExecutor,
  input: { raw: string; kind: AuthTokenKind; now?: Date },
): Promise<{ userId: string } | null> {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(authTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(input.raw)),
        eq(authTokens.kind, input.kind),
        isNull(authTokens.consumedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning({ userId: authTokens.userId });
  return row ?? null;
}

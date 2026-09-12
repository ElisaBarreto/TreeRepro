import type { AuthUser } from '@treerepro/contracts';
import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { type UserRow, users } from '../db/schema/users.ts';
import { getPii } from '../security/pii.ts';

/** @rfc RFC-20 R3 */
export class UserEmailTakenError extends Error {
  constructor() {
    super('Another account already uses this email');
    this.name = 'UserEmailTakenError';
  }
}

/** Stored form of an email: trimmed, case preserved. @rfc RFC-20 R3 */
export function normalizeEmail(email: string): string {
  return email.trim();
}

/** @rfc RFC-20 R3 */
export async function findUserByEmail(db: DbExecutor, email: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.emailHash, getPii().blindIndex(email)))
    .limit(1);
  return row ?? null;
}

/** @rfc RFC-20 R1 */
export async function findUserById(db: DbExecutor, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** @rfc RFC-20 R3, R4 */
export async function createInvitedUser(
  db: DbExecutor,
  input: { email: string; name: string; now?: Date },
): Promise<UserRow> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  try {
    const [row] = await db
      .insert(users)
      .values({
        email,
        emailHash: getPii().blindIndex(email),
        name: input.name.trim(),
        status: 'invited',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserEmailTakenError();
    throw err;
  }
}

/** Succeeds only while the user is `invited`. @rfc RFC-20 R2, R6 */
export async function activateUser(
  db: DbExecutor,
  input: { id: string; passwordHash: string; now?: Date },
): Promise<UserRow | null> {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(users)
    .set({ status: 'active', passwordHash: input.passwordHash, updatedAt: now })
    .where(and(eq(users.id, input.id), eq(users.status, 'invited')))
    .returning();
  return row ?? null;
}

/** @rfc RFC-21 R6, R7 */
export async function updatePasswordHash(
  db: DbExecutor,
  input: { id: string; passwordHash: string; now?: Date },
): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash: input.passwordHash, updatedAt: input.now ?? new Date() })
    .where(eq(users.id, input.id));
}

/** @rfc RFC-23 R3, R7 */
export async function updateTotp(
  db: DbExecutor,
  input: { id: string; secret: string | null; enabledAt: Date | null; now?: Date },
): Promise<void> {
  await db
    .update(users)
    .set({
      totpSecret: input.secret,
      totpEnabledAt: input.enabledAt,
      updatedAt: input.now ?? new Date(),
    })
    .where(eq(users.id, input.id));
}

/** @rfc RFC-22 R10 */
export function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    totpEnabled: user.totpEnabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

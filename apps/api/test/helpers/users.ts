import { randomBytes } from 'node:crypto';
import type { UserStatus } from '@treerepro/contracts';
import { hashPassword } from '../../src/auth/password.ts';
import type { DbExecutor } from '../../src/db/client.ts';
import { type UserRow, users } from '../../src/db/schema/users.ts';
import { getPii } from '../../src/security/pii.ts';

export const DEFAULT_PASSWORD = 'correct horse battery staple';

export function randomEmail(): string {
  return `u-${randomBytes(6).toString('hex')}@example.test`;
}

const hashes = new Map<string, Promise<string>>();
function cachedHash(password: string): Promise<string> {
  let p = hashes.get(password);
  if (!p) {
    p = hashPassword(password);
    hashes.set(password, p);
  }
  return p;
}

export interface CreateUserOptions {
  email?: string;
  name?: string;
  /** Default `active`. */
  status?: UserStatus;
  /** Default DEFAULT_PASSWORD; `null` leaves password_hash null. */
  password?: string | null;
  /** Base32 secret; sets totp_enabled_at when given. */
  totpSecret?: string;
}

/** Inserts a user directly (the invitation flow has its own tests). */
export async function createUser(
  db: DbExecutor,
  options: CreateUserOptions = {},
): Promise<{ user: UserRow; email: string; password: string }> {
  const email = options.email ?? randomEmail();
  const password = options.password === undefined ? DEFAULT_PASSWORD : options.password;
  const status = options.status ?? 'active';
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      email,
      emailHash: getPii().blindIndex(email),
      name: options.name ?? 'Test User',
      status,
      passwordHash: password === null ? null : await cachedHash(password),
      totpSecret: options.totpSecret ?? null,
      totpEnabledAt: options.totpSecret ? now : null,
      suspendedAt: status === 'suspended' ? now : null,
      deletedAt: status === 'deleted' ? now : null,
    })
    .returning();
  if (!user) throw new Error('createUser: insert returned no row');
  return { user, email, password: password ?? '' };
}

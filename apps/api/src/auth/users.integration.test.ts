import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb, withRollback } from '../../test/helpers/db.ts';
import { createUser, randomEmail } from '../../test/helpers/users.ts';
import { users } from '../db/schema/users.ts';
import {
  activateUser,
  createInvitedUser,
  findUserByEmail,
  findUserById,
  toAuthUser,
  UserEmailTakenError,
  updateTotp,
} from './users.ts';

describe('RFC-20 R3 users repository', () => {
  const t = useTestDb();

  it('creates an invited user and finds it through the blind index in any casing', async () => {
    await withRollback(t.db, async (tx) => {
      const email = `Ada.${randomEmail()}`;
      const user = await createInvitedUser(tx, { email: ` ${email} `, name: 'Ada' });
      expect(user.status).toBe('invited');
      expect(user.email).toBe(email);
      expect((await findUserByEmail(tx, email.toUpperCase()))?.id).toBe(user.id);
      expect((await findUserById(tx, user.id))?.name).toBe('Ada');
      expect(await findUserByEmail(tx, randomEmail())).toBeNull();
    });
  });

  it('refuses a duplicate email with UserEmailTakenError', async () => {
    await withRollback(t.db, async (tx) => {
      const email = randomEmail();
      await createInvitedUser(tx, { email, name: 'A' });
      await expect(
        tx.transaction((sp) => createInvitedUser(sp, { email: email.toUpperCase(), name: 'B' })),
      ).rejects.toBeInstanceOf(UserEmailTakenError);
    });
  });

  it('RFC-40 R11 equality on the encrypted email column never matches', async () => {
    await withRollback(t.db, async (tx) => {
      const email = randomEmail();
      await createInvitedUser(tx, { email, name: 'A' });
      expect(await tx.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    });
  });

  it('R2 activateUser works once, only from invited, and stamps updated_at', async () => {
    await withRollback(t.db, async (tx) => {
      const user = await createInvitedUser(tx, { email: randomEmail(), name: 'A' });
      const now = new Date(user.createdAt.getTime() + 1000);
      const active = await activateUser(tx, { id: user.id, passwordHash: '$argon2id$x', now });
      expect(active?.status).toBe('active');
      expect(active?.passwordHash).toBe('$argon2id$x');
      expect(active?.updatedAt.getTime()).toBe(now.getTime());
      expect(await activateUser(tx, { id: user.id, passwordHash: '$argon2id$y' })).toBeNull();
    });
  });

  it('updateTotp stores the secret encrypted and toAuthUser exposes only the public shape', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx, { status: 'active' });
      const enabledAt = new Date();
      await updateTotp(tx, { id: user.id, secret: 'JBSWY3DPEHPK3PXP', enabledAt });
      const fresh = await findUserById(tx, user.id);
      expect(fresh?.totpSecret).toBe('JBSWY3DPEHPK3PXP');
      expect(toAuthUser(fresh as NonNullable<typeof fresh>)).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        status: 'active',
        totpEnabled: true,
        createdAt: user.createdAt.toISOString(),
      });
    });
  });
});

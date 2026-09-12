import { describe, expect, it } from 'vitest';
import { fakeBreachChecker } from '../../test/helpers/breach.ts';
import {
  checkPasswordPolicy,
  dummyPasswordHash,
  hashPassword,
  PASSWORD_WEAKNESS_MESSAGES,
  passwordWeakError,
  verifyPassword,
} from './password.ts';

describe('RFC-21 R1 argon2id hashing', () => {
  it('produces a PHC string with the OWASP parameters and verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('never throws on a malformed stored hash', async () => {
    expect(await verifyPassword('not a hash', 'x')).toBe(false);
  });

  it('R4 dummyPasswordHash is computed once and verifies nothing', async () => {
    const a = await dummyPasswordHash();
    expect(a).toBe(await dummyPasswordHash());
    expect(await verifyPassword(a, '')).toBe(false);
  });
});

describe('RFC-21 R2, R3 password policy', () => {
  it('rejects fewer than 12 characters before consulting the breach checker', async () => {
    let asked = false;
    const checker = {
      isBreached: async () => {
        asked = true;
        return false;
      },
    };
    expect(await checkPasswordPolicy('elevenchars', checker)).toBe('too_short');
    expect(asked).toBe(false);
  });

  it('rejects breached passwords and accepts the rest', async () => {
    const checker = fakeBreachChecker(['password12345']);
    expect(await checkPasswordPolicy('password12345', checker)).toBe('breached');
    expect(await checkPasswordPolicy('a long enough unique phrase', checker)).toBeNull();
  });

  it('maps a weakness to AUTH_PASSWORD_WEAK with one detail', () => {
    const err = passwordWeakError('breached');
    expect(err.code).toBe('AUTH_PASSWORD_WEAK');
    expect(err.status).toBe(400);
    expect(err.details).toEqual([
      { path: 'password', message: PASSWORD_WEAKNESS_MESSAGES.breached },
    ]);
  });
});

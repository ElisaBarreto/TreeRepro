import { describe, expect, it } from 'vitest';
import {
  authUserSchema,
  changePasswordBodySchema,
  inviteAcceptBodySchema,
  loginBodySchema,
  loginTotpBodySchema,
  passwordSchema,
  recoveryCodeSchema,
  tokenSchema,
  totpDisableBodySchema,
} from './auth.ts';

const TOKEN = 'A'.repeat(43);

describe('RFC-02 R2 auth request schemas are strict', () => {
  it('loginBodySchema accepts email + password and rejects extra fields', () => {
    expect(loginBodySchema.safeParse({ email: 'a@b.example', password: 'x' }).success).toBe(true);
    expect(
      loginBodySchema.safeParse({ email: 'a@b.example', password: 'x', extra: 1 }).success,
    ).toBe(false);
    expect(loginBodySchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginBodySchema.safeParse({ email: 'a@b.example', password: '' }).success).toBe(false);
  });

  it('loginTotpBodySchema takes exactly one of code or recoveryCode', () => {
    expect(loginTotpBodySchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(loginTotpBodySchema.safeParse({ recoveryCode: 'abcde-fghij' }).success).toBe(true);
    expect(loginTotpBodySchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(
      loginTotpBodySchema.safeParse({ code: '123456', recoveryCode: 'abcde-fghij' }).success,
    ).toBe(false);
    expect(loginTotpBodySchema.safeParse({}).success).toBe(false);
  });

  it('RFC-21 R2 passwordSchema caps length at 128 and leaves the minimum to the API', () => {
    expect(passwordSchema.safeParse('short').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('RFC-20 R5 tokenSchema is 43 base64url characters', () => {
    expect(tokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(tokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(tokenSchema.safeParse(`${'A'.repeat(42)}+`).success).toBe(false);
    expect(inviteAcceptBodySchema.safeParse({ token: TOKEN, password: 'p' }).success).toBe(true);
  });

  it('RFC-23 R5 recoveryCodeSchema accepts xxxxx-xxxxx in any case, with or without the dash', () => {
    expect(recoveryCodeSchema.safeParse('abcde-fghij').success).toBe(true);
    expect(recoveryCodeSchema.safeParse('ABCDE23456').success).toBe(true);
    expect(recoveryCodeSchema.safeParse('abcde-fghi1').success).toBe(false);
  });

  it('change and disable bodies require the password', () => {
    expect(
      changePasswordBodySchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success,
    ).toBe(true);
    expect(changePasswordBodySchema.safeParse({ newPassword: 'b' }).success).toBe(false);
    expect(totpDisableBodySchema.safeParse({ password: 'a', code: '123456' }).success).toBe(true);
    expect(
      totpDisableBodySchema.safeParse({ password: 'a', recoveryCode: 'abcde-fghij' }).success,
    ).toBe(true);
    expect(totpDisableBodySchema.safeParse({ password: 'a' }).success).toBe(false);
  });

  it('RFC-22 R10 authUserSchema shape', () => {
    expect(
      authUserSchema.safeParse({
        id: '019b4a2e-5f3c-7c8e-8d1a-2f3b4c5d6e7f',
        email: 'a@b.example',
        name: 'Ada',
        status: 'active',
        totpEnabled: false,
        createdAt: '2026-09-12T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

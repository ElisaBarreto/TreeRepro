import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpUri,
  verifyTotpCode,
} from './totp.ts';

const T0 = Date.parse('2026-09-12T10:00:00Z');

describe('RFC-23 R1 secret and URI', () => {
  it('generates a 32-character base32 secret (20 bytes) and a TreeRepro otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = totpUri(secret, 'ada@example.test');
    expect(uri.startsWith('otpauth://totp/TreeRepro:ada%40example.test?')).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=TreeRepro');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('RFC-23 R4 verification window', () => {
  const secret = generateTotpSecret();

  it('accepts the current step and one step on each side, returning the step counter', () => {
    const code = generateTotpCode(secret, T0);
    const step = Math.floor(T0 / 1000 / 30);
    expect(verifyTotpCode(secret, code, T0)).toBe(step);
    expect(verifyTotpCode(secret, code, T0 + 30_000)).toBe(step);
    expect(verifyTotpCode(secret, code, T0 - 30_000)).toBe(step);
    expect(verifyTotpCode(secret, code, T0 + 60_000)).toBeNull();
  });

  it('rejects a wrong code', () => {
    const code = generateTotpCode(secret, T0);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    expect(verifyTotpCode(secret, wrong, T0)).toBeNull();
  });
});

describe('RFC-23 R5 recovery codes', () => {
  it('generates ten distinct xxxxx-xxxxx codes and hashes the normalized form', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(normalizeRecoveryCode(' AbCdE-fGhIj ')).toBe('abcdefghij');
    expect(hashRecoveryCode('abcde-fghij')).toBe(hashRecoveryCode('ABCDEFGHIJ'));
    expect(hashRecoveryCode('abcde-fghij')).toMatch(/^[0-9a-f]{64}$/);
  });
});

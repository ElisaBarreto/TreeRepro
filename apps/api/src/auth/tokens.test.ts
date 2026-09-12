import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, TOKEN_TTL_MS } from './tokens.ts';

describe('RFC-20 R5 token format', () => {
  it('generates 43 base64url characters and hashes with sha256 hex', () => {
    const raw = generateToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(raw);
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it('lifetimes are 72 h for invitations and 1 h for resets', () => {
    expect(TOKEN_TTL_MS.invite).toBe(72 * 60 * 60 * 1000);
    expect(TOKEN_TTL_MS.password_reset).toBe(60 * 60 * 1000);
  });
});

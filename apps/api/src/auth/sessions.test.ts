import { describe, expect, it } from 'vitest';
import {
  deriveKeyId,
  generateRawId,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
} from './sessions.ts';

describe('RFC-22 R4, R6 session identifiers and lifetimes', () => {
  it('raw ids are 43 base64url characters; keys are HMAC-SHA256 hex of the raw id', () => {
    const raw = generateRawId();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const secret = Buffer.alloc(32, 1);
    expect(deriveKeyId(secret, raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveKeyId(secret, raw)).toBe(deriveKeyId(secret, raw));
    expect(deriveKeyId(Buffer.alloc(32, 2), raw)).not.toBe(deriveKeyId(secret, raw));
  });

  it('idle 12 h, absolute 7 d', () => {
    expect(SESSION_IDLE_TTL_MS).toBe(12 * 3600 * 1000);
    expect(SESSION_ABSOLUTE_TTL_MS).toBe(7 * 24 * 3600 * 1000);
  });
});

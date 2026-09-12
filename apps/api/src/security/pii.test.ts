import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blindIndex,
  configurePii,
  decryptPii,
  encryptPii,
  getPii,
  keyringFromHex,
  normalizeForIndex,
  PiiDecryptError,
  PiiError,
  resetPii,
} from './pii.ts';

const k1 = randomBytes(32).toString('hex');
const k2 = randomBytes(32).toString('hex');
const keyring = keyringFromHex('v1', { v1: k1 });
const hmacKey = randomBytes(32);

describe('RFC-40 R2 encryptPii / decryptPii', () => {
  it('round-trips and uses the v1:iv:tag:ct format', () => {
    const stored = encryptPii(keyring, 'Ada Lovelace');
    const parts = stored.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1] ?? '', 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[2] ?? '', 'base64url')).toHaveLength(16);
    expect(stored).not.toContain('Ada');
    expect(decryptPii(keyring, stored)).toBe('Ada Lovelace');
  });

  it('round-trips unicode and empty strings', () => {
    for (const s of ['', 'çãé 日本 🧬'])
      expect(decryptPii(keyring, encryptPii(keyring, s))).toBe(s);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptPii(keyring, 'x')).not.toBe(encryptPii(keyring, 'x'));
  });
});

describe('RFC-40 R4 decrypt failures', () => {
  it('rejects malformed values', () => {
    expect(() => decryptPii(keyring, 'plain text')).toThrow(PiiDecryptError);
    expect(() => decryptPii(keyring, 'v1:a:b')).toThrow(PiiDecryptError);
  });

  it('rejects unknown key versions', () => {
    const stored = encryptPii(keyring, 'x').replace(/^v1/, 'v9');
    expect(() => decryptPii(keyring, stored)).toThrow(PiiDecryptError);
  });

  it('rejects tampered ciphertext', () => {
    const stored = encryptPii(keyring, 'sensitive');
    const parts = stored.split(':');
    const ct = Buffer.from(parts[3] ?? '', 'base64url');
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => decryptPii(keyring, parts.join(':'))).toThrow(PiiDecryptError);
  });

  it('rejects a value encrypted with a different key of the same version', () => {
    const other = keyringFromHex('v1', { v1: k2 });
    expect(() => decryptPii(other, encryptPii(keyring, 'x'))).toThrow(PiiDecryptError);
  });
});

describe('RFC-40 R3, R7 keyring and rotation', () => {
  it('keyringFromHex validates 64 hex characters and the current version', () => {
    expect(() => keyringFromHex('v1', { v1: 'abc' })).toThrow(PiiError);
    expect(() => keyringFromHex('v2', { v1: k1 })).toThrow(PiiError);
    expect(keyringFromHex('v1', { v1: k1 }).keys.get('v1')).toHaveLength(32);
  });

  it('R6 keyringFromHex never echoes the offending key material in the error', () => {
    const bad = 'deadbeef'.repeat(8).slice(0, 60);
    let thrown: unknown;
    try {
      keyringFromHex('v1', { v1: bad });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PiiError);
    expect((thrown as Error).message).not.toContain(bad);
    expect((thrown as Error).message).not.toContain('deadbeef');
  });

  it('encrypts with the current key and still decrypts older versions', () => {
    const rotated = keyringFromHex('v2', { v1: k1, v2: k2 });
    const old = encryptPii(keyring, 'legacy');
    const fresh = encryptPii(rotated, 'new');
    expect(fresh.startsWith('v2:')).toBe(true);
    expect(decryptPii(rotated, old)).toBe('legacy');
    expect(decryptPii(rotated, fresh)).toBe('new');
  });
});

describe('RFC-40 R5 blind index', () => {
  it('normalizes with NFKC, trim and lowercase', () => {
    expect(normalizeForIndex('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizeForIndex('ﬁ')).toBe('fi');
  });

  it('is deterministic for equivalent inputs and differs across keys', () => {
    const a = blindIndex(hmacKey, 'Ada@Example.com');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(blindIndex(hmacKey, ' ada@example.com ')).toBe(a);
    expect(blindIndex(randomBytes(32), 'ada@example.com')).not.toBe(a);
  });
});

describe('RFC-40 R9 process-wide configuration', () => {
  afterEach(() => resetPii());

  it('throws before configuration', () => {
    expect(() => getPii()).toThrow(PiiError);
  });

  it('exposes encrypt/decrypt/blindIndex after configuration', () => {
    configurePii(keyring, hmacKey);
    const pii = getPii();
    expect(pii.decrypt(pii.encrypt('x'))).toBe('x');
    expect(pii.blindIndex('X')).toBe(blindIndex(hmacKey, 'x'));
  });
});

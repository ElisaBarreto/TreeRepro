import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blindIndex,
  decryptPii,
  encryptPii,
  keyringFromHex,
  normalizeForIndex,
  PiiDecryptError,
} from './pii.ts';

// Property-based counterpart of pii.test.ts: the example tests pin the format,
// these check the invariants over generated inputs (random plaintexts, column
// names and bit flips), so a regression outside the hand-picked cases still
// fails.

const keyring = keyringFromHex('v1', { v1: randomBytes(32).toString('hex') });
const hmacKey = randomBytes(32);
const AAD = 'users.email';

/** Well-formed strings over the whole Unicode range (graphemes, not just ASCII). */
const plaintextArb = fc.string({ unit: 'grapheme' });

/** Qualified column names as RFC-40 R2 spells them: `<table>.<column>`. */
const aadArb = fc
  .tuple(fc.stringMatching(/^[a-z_]{1,24}$/), fc.stringMatching(/^[a-z_]{1,24}$/))
  .map(([table, column]) => `${table}.${column}`);

/** Strings over an ASCII alphabet whose case mapping is one-to-one. */
const asciiArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-+'),
});

const whitespaceArb = fc.string({ unit: fc.constantFrom(' ', '\t', '\n', '\r'), maxLength: 4 });

const BASE64URL = /^[A-Za-z0-9_-]*$/;

describe('RFC-40 R2 encryptPii / decryptPii properties', () => {
  it('round-trips any plaintext under its own column name', () => {
    fc.assert(
      fc.property(plaintextArb, aadArb, (plaintext, aad) => {
        expect(decryptPii(keyring, encryptPii(keyring, plaintext, aad), aad)).toBe(plaintext);
      }),
    );
  });

  it('stores version:iv:tag:ciphertext with base64url parts, so the separator is unambiguous', () => {
    fc.assert(
      fc.property(plaintextArb, aadArb, (plaintext, aad) => {
        const parts = encryptPii(keyring, plaintext, aad).split(':');
        expect(parts).toHaveLength(4);
        expect(parts[0]).toBe('v1');
        for (const part of parts.slice(1)) expect(part).toMatch(BASE64URL);
        expect(Buffer.from(parts[1] ?? '', 'base64url')).toHaveLength(12);
        expect(Buffer.from(parts[2] ?? '', 'base64url')).toHaveLength(16);
        expect(Buffer.from(parts[3] ?? '', 'base64url')).toHaveLength(
          Buffer.byteLength(plaintext, 'utf8'),
        );
      }),
    );
  });

  it('rejects the ciphertext under any other column name (AAD binding)', () => {
    fc.assert(
      fc.property(plaintextArb, aadArb, aadArb, (plaintext, aad, other) => {
        fc.pre(aad !== other);
        const stored = encryptPii(keyring, plaintext, aad);
        expect(() => decryptPii(keyring, stored, other)).toThrow(PiiDecryptError);
      }),
    );
  });

  it('R4 rejects any single bit flip in the iv, tag or ciphertext', () => {
    fc.assert(
      fc.property(plaintextArb, fc.nat(), fc.integer({ min: 0, max: 7 }), (plaintext, at, bit) => {
        const parts = encryptPii(keyring, plaintext, AAD).split(':');
        const bytes = parts.slice(1).map((part) => Buffer.from(part, 'base64url'));
        const total = bytes.reduce((sum, buffer) => sum + buffer.length, 0);
        let offset = at % total;
        const partIndex = bytes.findIndex((buffer) => {
          if (offset < buffer.length) return true;
          offset -= buffer.length;
          return false;
        });
        const target = bytes[partIndex];
        if (!target) throw new Error('unreachable: offset outside the stored bytes');
        target[offset] = (target[offset] ?? 0) ^ (1 << bit);
        const tampered = [parts[0], ...bytes.map((buffer) => buffer.toString('base64url'))].join(
          ':',
        );
        expect(() => decryptPii(keyring, tampered, AAD)).toThrow(PiiDecryptError);
      }),
    );
  });
});

describe('RFC-40 R5 normalizeForIndex / blindIndex properties', () => {
  it('normalizeForIndex is idempotent', () => {
    fc.assert(
      fc.property(plaintextArb, (value) => {
        const once = normalizeForIndex(value);
        expect(normalizeForIndex(once)).toBe(once);
      }),
    );
  });

  it('blindIndex is a deterministic 64-hex digest', () => {
    fc.assert(
      fc.property(plaintextArb, (value) => {
        const digest = blindIndex(hmacKey, value);
        expect(digest).toMatch(/^[0-9a-f]{64}$/);
        expect(blindIndex(hmacKey, value)).toBe(digest);
      }),
    );
  });

  it('blindIndex ignores letter case and surrounding whitespace', () => {
    fc.assert(
      fc.property(asciiArb, whitespaceArb, whitespaceArb, (value, before, after) => {
        const padded = `${before}${value.toUpperCase()}${after}`;
        expect(blindIndex(hmacKey, padded)).toBe(blindIndex(hmacKey, value.toLowerCase()));
      }),
    );
  });

  it('blindIndex separates values that differ after normalization', () => {
    fc.assert(
      fc.property(asciiArb, asciiArb, (a, b) => {
        fc.pre(normalizeForIndex(a) !== normalizeForIndex(b));
        expect(blindIndex(hmacKey, a)).not.toBe(blindIndex(hmacKey, b));
      }),
    );
  });
});

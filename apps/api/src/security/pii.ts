import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export interface PiiKeyring {
  /** Version label used for new encryptions, e.g. "v1". */
  current: string;
  /** Version label → 32-byte key. */
  keys: ReadonlyMap<string, Buffer>;
}

export interface Pii {
  encrypt(plaintext: string): string;
  decrypt(stored: string): string;
  blindIndex(value: string): string;
}

/** @rfc RFC-40 R4, R9 */
export class PiiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PiiError';
  }
}

/** @rfc RFC-40 R4 */
export class PiiDecryptError extends PiiError {
  constructor() {
    super('PII value cannot be decrypted');
    this.name = 'PiiDecryptError';
  }
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^v\d+$/;

/** @rfc RFC-40 R3 */
export function keyringFromHex(current: string, keysHex: Record<string, string>): PiiKeyring {
  const keys = new Map<string, Buffer>();
  for (const [version, hex] of Object.entries(keysHex)) {
    if (!VERSION_RE.test(version)) throw new PiiError(`invalid key version label "${version}"`);
    if (!KEY_HEX_RE.test(hex)) throw new PiiError(`key ${version} must be 64 hex characters`);
    keys.set(version, Buffer.from(hex, 'hex'));
  }
  if (!keys.has(current))
    throw new PiiError(`current key version ${current} is not in the keyring`);
  return { current, keys };
}

/** @rfc RFC-40 R2, R10 */
export function encryptPii(keyring: PiiKeyring, plaintext: string): string {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new PiiError('current key missing from keyring');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    keyring.current,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** @rfc RFC-40 R2, R4 */
export function decryptPii(keyring: PiiKeyring, stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4) throw new PiiDecryptError();
  const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const key = keyring.keys.get(version);
  if (!key) throw new PiiDecryptError();
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new PiiDecryptError();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    throw new PiiDecryptError();
  }
}

/** @rfc RFC-40 R5 */
export function normalizeForIndex(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** @rfc RFC-40 R5 */
export function blindIndex(hmacKey: Buffer, value: string): string {
  return createHmac('sha256', hmacKey).update(normalizeForIndex(value), 'utf8').digest('hex');
}

let configured: Pii | null = null;

/** @rfc RFC-40 R9 */
export function configurePii(keyring: PiiKeyring, hmacKey: Buffer): void {
  configured = {
    encrypt: (plaintext) => encryptPii(keyring, plaintext),
    decrypt: (stored) => decryptPii(keyring, stored),
    blindIndex: (value) => blindIndex(hmacKey, value),
  };
}

/** @rfc RFC-40 R9 */
export function getPii(): Pii {
  if (configured === null) throw new PiiError('PII module is not configured');
  return configured;
}

/** @rfc RFC-40 R9 */
export function resetPii(): void {
  configured = null;
}

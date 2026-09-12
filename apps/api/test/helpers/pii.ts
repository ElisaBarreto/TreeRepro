import { keyringFromHex } from '../../src/security/pii.ts';

export const TEST_KEYRING = keyringFromHex('v1', { v1: 'a'.repeat(64) });
export const TEST_HMAC_KEY = Buffer.alloc(32, 7);

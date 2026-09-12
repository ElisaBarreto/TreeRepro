import { createHash, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

/** @rfc RFC-23 R1 */
export const TOTP_ISSUER = 'TreeRepro';
/** @rfc RFC-23 R1 */
export const TOTP_PERIOD = 30;
/** @rfc RFC-23 R1 */
export const TOTP_DIGITS = 6;
/** Steps accepted on each side of the current one. @rfc RFC-23 R4 */
export const TOTP_WINDOW = 1;
/** @rfc RFC-23 R5 */
export const RECOVERY_CODE_COUNT = 10;

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function totp(secret: string, label = ''): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(secret),
  });
}

/** 20 random bytes as base32. @rfc RFC-23 R1 */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** @rfc RFC-23 R1 */
export function totpUri(secret: string, email: string): string {
  return totp(secret, email).toString();
}

/** Used by tests and by nothing else in production. @rfc RFC-23 R1 */
export function generateTotpCode(secret: string, timestamp = Date.now()): string {
  return totp(secret).generate({ timestamp });
}

/**
 * Returns the step counter of the accepted code (for the replay guard) or
 * null when the code is not valid within the window.
 * @rfc RFC-23 R4
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  timestamp = Date.now(),
): number | null {
  const delta = totp(secret).validate({ token: code, window: TOTP_WINDOW, timestamp });
  if (delta === null) return null;
  return Math.floor(timestamp / 1000 / TOTP_PERIOD) + delta;
}

/** @rfc RFC-23 R5 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    // 256 % 32 === 0, so a byte modulo 32 is unbiased.
    const chars = [...randomBytes(10)].map((b) => BASE32_ALPHABET[b % 32]).join('');
    const code = `${chars.slice(0, 5)}-${chars.slice(5)}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** @rfc RFC-23 R5 */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replaceAll(/[^a-z2-7]/g, '');
}

/** @rfc RFC-23 R5 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code), 'utf8').digest('hex');
}

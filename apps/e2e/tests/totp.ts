import { Secret, TOTP } from 'otpauth';

/**
 * The code an authenticator app would show for `secret` at `stepOffset`
 * 30-second steps from now. The API's parameters (RFC-23 R1) and its replay
 * guard (RFC-23 R4: one accepted code per step) mean a second sign-in in the
 * same half-minute must use the next step — `codeFor(secret, 1)`.
 */
export function codeFor(secret: string, stepOffset = 0): string {
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.generate({ timestamp: Date.now() + stepOffset * 30_000 });
}

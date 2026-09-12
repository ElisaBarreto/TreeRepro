import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';
import { AppError } from '../http/errors.ts';
import type { PasswordBreachChecker } from './breach-check.ts';

/** OWASP recommended argon2id parameters; memory in KiB. @rfc RFC-21 R1 */
export const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** @rfc RFC-21 R2 */
export const PASSWORD_MIN_LENGTH = 12;

/** @rfc RFC-21 R1 */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** @rfc RFC-21 R1 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/**
 * A hash nobody knows the preimage of, so login can run argon2 for accounts
 * that cannot log in and take the same time as for real ones.
 * @rfc RFC-21 R4
 */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString('hex'));
  return dummy;
}

export type PasswordWeakness = 'too_short' | 'breached';

/** @rfc RFC-21 R2 */
export const PASSWORD_WEAKNESS_MESSAGES: Record<PasswordWeakness, string> = {
  too_short: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
  breached: 'This password appears in known data breaches; choose another one.',
};

/** @rfc RFC-21 R2, R3 */
export async function checkPasswordPolicy(
  password: string,
  checker: PasswordBreachChecker,
): Promise<PasswordWeakness | null> {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (await checker.isBreached(password)) return 'breached';
  return null;
}

/** @rfc RFC-21 R2 */
export function passwordWeakError(weakness: PasswordWeakness): AppError {
  return new AppError('AUTH_PASSWORD_WEAK', 'Password does not meet the policy', [
    { path: 'password', message: PASSWORD_WEAKNESS_MESSAGES[weakness] },
  ]);
}

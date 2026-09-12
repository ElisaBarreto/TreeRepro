import type { PasswordBreachChecker } from '../../src/auth/breach-check.ts';

/** A checker that flags exactly the given passwords. */
export function fakeBreachChecker(breached: string[] = []): PasswordBreachChecker {
  const set = new Set(breached);
  return { isBreached: async (password) => set.has(password) };
}

/** @rfc RFC-21 R3 */
export interface PasswordBreachChecker {
  isBreached(password: string): Promise<boolean>;
}

export type GuardKind = 'session' | 'permission';

const guards = new WeakMap<object, GuardKind>();

/** Registers a middleware as a route guard of the given kind for the RFC-02 R12 meta-test. @rfc RFC-02 R12 */
export function markGuard<T extends object>(fn: T, kind: GuardKind): T {
  guards.set(fn, kind);
  return fn;
}

/** @rfc RFC-02 R12 */
export function guardKind(fn: unknown): GuardKind | undefined {
  return typeof fn === 'function' ? guards.get(fn) : undefined;
}

/** @rfc RFC-02 R12 */
export function isGuard(fn: unknown): boolean {
  return guardKind(fn) !== undefined;
}

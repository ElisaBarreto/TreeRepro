const guards = new WeakSet<object>();

/** Registers a middleware as a route guard for the RFC-02 R12 meta-test. @rfc RFC-02 R12 */
export function markGuard<T extends object>(fn: T): T {
  guards.add(fn);
  return fn;
}

/** @rfc RFC-02 R12 */
export function isGuard(fn: unknown): boolean {
  return typeof fn === 'function' && guards.has(fn);
}

import type { PermissionKey } from '@treerepro/contracts';

/** @rfc RFC-32 R5 */
export type GuardKind = 'session' | 'permission' | 'apiKey';

const guards = new WeakMap<object, GuardKind>();
const permissions = new WeakMap<object, PermissionKey>();

/**
 * Registers a middleware as a route guard of the given kind for the RFC-02 R12
 * meta-test; a permission guard also records the key it requires, so the
 * visibility meta-test (RFC-33 R10) can pick the routes behind a given
 * permission.
 * @rfc RFC-02 R12
 * @rfc RFC-32 R5
 * @rfc RFC-33 R10
 */
export function markGuard<T extends object>(fn: T, kind: GuardKind, permission?: PermissionKey): T {
  guards.set(fn, kind);
  if (permission) permissions.set(fn, permission);
  return fn;
}

/** @rfc RFC-02 R12 */
export function guardKind(fn: unknown): GuardKind | undefined {
  return typeof fn === 'function' ? guards.get(fn) : undefined;
}

/** The permission a `requirePermission` guard names; undefined for any other handler. @rfc RFC-33 R10 */
export function guardPermission(fn: unknown): PermissionKey | undefined {
  return typeof fn === 'function' ? permissions.get(fn) : undefined;
}

/** @rfc RFC-02 R12 */
export function isGuard(fn: unknown): boolean {
  return guardKind(fn) !== undefined;
}

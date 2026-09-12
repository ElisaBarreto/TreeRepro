import { describe, expect, it } from 'vitest';
import { guardKind, isGuard, markGuard } from './guards.ts';

describe('RFC-02 R12 guard registry', () => {
  it('records the kind of a guard and answers undefined for anything else', () => {
    const session = markGuard(async () => undefined, 'session');
    const permission = markGuard(async () => undefined, 'permission');
    expect(guardKind(session)).toBe('session');
    expect(guardKind(permission)).toBe('permission');
    expect(isGuard(session)).toBe(true);
    expect(guardKind(() => undefined)).toBeUndefined();
    expect(isGuard('nope')).toBe(false);
  });
});

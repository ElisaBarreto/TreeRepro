import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, auditLogEntrySchema, auditQuerySchema, isAuditAction } from './audit.ts';

describe('RFC-51 R2 audit entry', () => {
  it('accepts the documented shape with nulls and rejects extras', () => {
    const entry = {
      id: '019a0000-0000-7000-8000-000000000001',
      at: '2026-09-12T00:00:00.000Z',
      actorUserId: null,
      action: 'auth.login.failure',
      targetType: null,
      targetId: null,
      ip: '203.0.113.1',
      userAgent: null,
      metadata: { reason: 'unknown_email' },
    };
    expect(auditLogEntrySchema.safeParse(entry).success).toBe(true);
    expect(auditLogEntrySchema.safeParse({ ...entry, extra: 1 }).success).toBe(false);
    expect(auditLogEntrySchema.safeParse({ ...entry, metadata: [] }).success).toBe(false);
  });
});

describe('RFC-51 R1, R4 audit query', () => {
  it('accepts filters and pagination; rejects a malformed actor, action, instant, or from after to', () => {
    const ok = auditQuerySchema.parse({
      actor: '019a0000-0000-7000-8000-000000000001',
      action: 'auth.login.success',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      limit: '5',
    });
    expect(ok.limit).toBe(5);
    expect(auditQuerySchema.safeParse({ actor: 'me' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ action: 'Login' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    const swapped = auditQuerySchema.safeParse({
      from: '2026-02-01T00:00:00Z',
      to: '2026-01-01T00:00:00Z',
    });
    expect(swapped.success).toBe(false);
    if (!swapped.success) expect(swapped.error.issues[0]?.path).toEqual(['from']);
    expect(
      auditQuerySchema.safeParse({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00Z' })
        .success,
    ).toBe(true);
  });
});

describe('RFC-41 R3 action catalog', () => {
  it('holds the catalog keys in <domain>.<event> form and answers membership', () => {
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(20);
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^[a-z_]+(?:\.[a-z_]+)+$/);
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(isAuditAction('auth.login.success')).toBe(true);
    expect(isAuditAction('users.created')).toBe(true);
    expect(isAuditAction('Login')).toBe(false);
  });
});

describe('RFC-75 R2, R4 proposal audit actions', () => {
  it('recognises proposals.created and proposals.decided', () => {
    expect(isAuditAction('proposals.created')).toBe(true);
    expect(isAuditAction('proposals.decided')).toBe(true);
    expect(AUDIT_ACTIONS).toContain('proposals.created');
    expect(AUDIT_ACTIONS).toContain('proposals.decided');
  });
});

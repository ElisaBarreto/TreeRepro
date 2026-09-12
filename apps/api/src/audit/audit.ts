import type { DbExecutor } from '../db/client.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { AUDIT_ACTIONS, type AuditAction } from './actions.ts';

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/** @rfc RFC-41 R7 */
export const FORBIDDEN_METADATA_KEYS = [
  'password',
  'passwordHash',
  'token',
  'secret',
  'email',
  'name',
  'ip',
  'userAgent',
] as const;

/** @rfc RFC-41 R7 */
export class AuditMetadataError extends Error {
  constructor(path: string) {
    super(`metadata key "${path}" is not allowed`);
    this.name = 'AuditMetadataError';
  }
}

/** @rfc RFC-41 R3 */
export class AuditActionError extends Error {
  constructor(action: string) {
    super(`unknown audit action "${action}"`);
    this.name = 'AuditActionError';
  }
}

const forbidden = new Set<string>(FORBIDDEN_METADATA_KEYS);

/** @rfc RFC-41 R7 */
export function assertSafeMetadata(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      assertSafeMetadata(item, path ? `${path}.${i}` : String(i));
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) throw new AuditMetadataError(childPath);
      assertSafeMetadata(child, childPath);
    }
  }
}

/**
 * Writes one audit row using the caller's executor, so it commits or rolls back
 * together with the action being recorded.
 * @rfc RFC-41 R1, R3-R5, R7-R8
 */
export async function recordAudit(db: DbExecutor, entry: AuditEntry): Promise<{ id: string }> {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(entry.action)) {
    throw new AuditActionError(entry.action);
  }
  const metadata = entry.metadata ?? {};
  assertSafeMetadata(metadata);
  const [row] = await db
    .insert(auditLog)
    .values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      metadata,
    })
    .returning({ id: auditLog.id });
  if (!row) throw new Error('audit insert returned no row');
  return row;
}

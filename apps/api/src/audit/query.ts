import type { AuditLogEntry } from '@treerepro/contracts';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { type AuditLogRow, auditLog } from '../db/schema/audit-log.ts';
import { decodeCursor, encodeCursor } from '../http/cursor.ts';
import type { AuditAction } from './actions.ts';

/** `ip` and `userAgent` arrive decrypted from the column type (RFC-40 R8). @rfc RFC-51 R2 */
export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    ip: row.ip,
    userAgent: row.userAgent,
    metadata: row.metadata,
  };
}

/**
 * Newest first by id (UUID v7); `from`/`to` bound `at` inclusively.
 *
 * `at` is stored with microsecond precision (RFC-51 R3) but `from`/`to` arrive
 * as JS `Date`s, which only carry millisecond precision; comparing `to` with
 * `<=` would silently exclude rows whose stored instant falls later in the
 * same millisecond. Comparing against the start of the next millisecond with
 * `<` keeps the whole millisecond named by `to` inclusive.
 * @rfc RFC-51 R1, R3
 */
export async function queryAudit(
  db: DbExecutor,
  input: {
    actor?: string;
    action?: AuditAction;
    from?: Date;
    to?: Date;
    cursor?: string;
    limit: number;
  },
): Promise<{ data: AuditLogEntry[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (input.actor) conditions.push(eq(auditLog.actorUserId, input.actor));
  if (input.action) conditions.push(eq(auditLog.action, input.action));
  if (input.from) conditions.push(gte(auditLog.at, input.from));
  if (input.to) conditions.push(lt(auditLog.at, new Date(input.to.getTime() + 1)));
  if (input.cursor) conditions.push(lt(auditLog.id, decodeCursor(input.cursor)));
  const rows = await db
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(toAuditLogEntry),
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.id) : null,
  };
}

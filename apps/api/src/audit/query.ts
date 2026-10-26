import type { AuditLogEntry, AuditSort, SortOrder } from '@treerepro/contracts';
import { and, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { type AuditLogRow, auditLog } from '../db/schema/audit-log.ts';
import { pageOf, type SortKey, sortedKeyset } from '../http/cursor.ts';
import type { AuditAction } from './actions.ts';

// The audit list's sort columns (RFC-51 R1, RFC-11 R10).
const AUDIT_COLUMNS: Record<AuditSort, SortKey> = {
  at: { expr: sql`${auditLog.at}`, type: 'timestamptz' },
  action: { expr: sql`${auditLog.action}`, type: 'text' },
};

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
 * Newest first unless `sort` names another column (RFC-11 R10); `from`/`to`
 * bound `at` inclusively.
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
    sort?: AuditSort;
    order?: SortOrder;
    cursor?: string;
    limit: number;
  },
): Promise<{ data: AuditLogEntry[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (input.actor) conditions.push(eq(auditLog.actorUserId, input.actor));
  if (input.action) conditions.push(eq(auditLog.action, input.action));
  if (input.from) conditions.push(gte(auditLog.at, input.from));
  if (input.to) conditions.push(lt(auditLog.at, new Date(input.to.getTime() + 1)));
  const keyset = sortedKeyset({
    columns: AUDIT_COLUMNS,
    sort: input.sort ?? 'at',
    order: input.order ?? (input.sort ? 'asc' : 'desc'),
    id: auditLog.id,
    cursor: input.cursor,
  });
  if (keyset.where) conditions.push(keyset.where);
  const rows = await db
    .select({ entry: auditLog, sortKey: keyset.key.as('sort_key') })
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...keyset.orderBy)
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    keyset.cursorOf({ sortKey: r.sortKey, id: r.entry.id }),
  );
  return { data: page.map((r) => toAuditLogEntry(r.entry)), nextCursor };
}

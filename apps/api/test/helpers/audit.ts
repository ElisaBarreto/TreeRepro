import { and, desc, eq } from 'drizzle-orm';
import type { AuditAction } from '../../src/audit/actions.ts';
import type { DbExecutor } from '../../src/db/client.ts';
import { type AuditLogRow, auditLog } from '../../src/db/schema/audit-log.ts';

/**
 * Narrows a `lastAudit` lookup to rows this test itself created. The
 * `api:integration` project runs every file concurrently against one shared
 * testcontainer Postgres, so an unscoped "most recent row for this action"
 * query can return a row another file wrote a moment later. At least one of
 * `actorUserId`, `targetId` or `ip` is required; each test creates its own
 * users (and, via `randomIp()`, its own IPs), so these values are unique to
 * it.
 */
export interface AuditScope {
  actorUserId?: string;
  targetId?: string;
  /**
   * Narrows by the request's IP, for actions with neither an actor nor a
   * target (e.g. a failed login for an unknown email). `audit_log.ip` is an
   * encrypted column and cannot be filtered in SQL (RFC-40 R11), so this
   * fetches the most recent rows for the action and matches the decrypted
   * value in JS.
   */
  ip?: string;
}

/** How many recent rows to scan in JS when scoping by `ip`. */
const RECENT_ROWS_FOR_IP_SCAN = 20;

/**
 * The most recent `audit_log` row for `action` narrowed to `scope`, so that
 * concurrent writes from other integration test files cannot be picked up
 * instead of the row this test wrote. See `AuditScope` for what to pass.
 */
export async function lastAudit(
  db: DbExecutor,
  action: AuditAction,
  scope: AuditScope,
): Promise<AuditLogRow | undefined> {
  if (!scope.actorUserId && !scope.targetId && !scope.ip) {
    throw new Error('lastAudit: scope needs actorUserId, targetId, or ip to narrow the query');
  }
  const conditions = [eq(auditLog.action, action)];
  if (scope.actorUserId) conditions.push(eq(auditLog.actorUserId, scope.actorUserId));
  if (scope.targetId) conditions.push(eq(auditLog.targetId, scope.targetId));
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.id))
    .limit(scope.ip ? RECENT_ROWS_FOR_IP_SCAN : 1);
  return scope.ip ? rows.find((row) => row.ip === scope.ip) : rows[0];
}

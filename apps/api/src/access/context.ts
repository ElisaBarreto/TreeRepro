import type { DbExecutor } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import type { PermissionCache } from './permissions.ts';

/**
 * What the access services need; `AuthContext` satisfies it. `db` may be a
 * transaction — the services open nested transactions (savepoints) on it.
 * @rfc RFC-32 R1
 */
export interface AccessContext {
  db: DbExecutor;
  permissionCache: PermissionCache;
  logger: Logger;
  now: () => number;
}

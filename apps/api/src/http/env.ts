import type { PermissionKey, Platform, PlotRef } from '@treerepro/contracts';
import type { RequestIdVariables } from 'hono/request-id';
import type { Visibility } from '../access/visibility.ts';
import type { SessionRecord } from '../auth/sessions.ts';
import type { UserRow } from '../db/schema/users.ts';
import type { Logger } from '../logger.ts';

export type AppEnv = {
  Variables: RequestIdVariables & {
    logger: Logger;
    /** Set by `resolvePlatform` on every route but health (RFC-14 R3). */
    platform: Platform;
    session?: SessionRecord;
    user?: UserRow;
    apiKey?: { id: string };
    permissions?: ReadonlySet<PermissionKey>;
    visibility?: Visibility;
    userScope?: { plots: PlotRef[]; restricted: boolean };
  };
};

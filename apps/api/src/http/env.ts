import type { PermissionKey, PlotRef } from '@treerepro/contracts';
import type { RequestIdVariables } from 'hono/request-id';
import type { Visibility } from '../access/visibility.ts';
import type { SessionRecord } from '../auth/sessions.ts';
import type { UserRow } from '../db/schema/users.ts';
import type { Logger } from '../logger.ts';

export type AppEnv = {
  Variables: RequestIdVariables & {
    logger: Logger;
    session?: SessionRecord;
    user?: UserRow;
    apiKey?: { id: string };
    permissions?: ReadonlySet<PermissionKey>;
    visibility?: Visibility;
    userScope?: { plots: PlotRef[]; restricted: boolean };
  };
};

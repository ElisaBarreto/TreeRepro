import type { RequestIdVariables } from 'hono/request-id';
import type { Logger } from '../logger.ts';

export type AppEnv = { Variables: RequestIdVariables & { logger: Logger } };

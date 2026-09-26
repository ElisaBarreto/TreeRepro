import { AsyncLocalStorage } from 'node:async_hooks';

/** Set while `POST /api/batch` dispatches one of its operations. @rfc RFC-82 R14 */
export const batchDispatch = new AsyncLocalStorage<true>();

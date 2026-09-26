import { AsyncLocalStorage } from 'node:async_hooks';

/** Set for the lifetime of a key-authenticated request. @rfc RFC-82 R8 */
export const auditVia = new AsyncLocalStorage<{ apiKeyId: string }>();

import { Redis } from 'ioredis';

/** @rfc RFC-10 R2 */
export function createRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
}

export type { Redis };

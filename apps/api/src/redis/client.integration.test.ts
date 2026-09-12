import { describe, expect, inject, it } from 'vitest';
import { createRedis } from './client.ts';

describe('RFC-10 R2 redis client', () => {
  it('connects with the password from the url, pings and round-trips a key', async () => {
    const redis = createRedis(inject('redisUrl'));
    await redis.connect();
    try {
      expect(await redis.ping()).toBe('PONG');
      await redis.set('probe', '1', 'EX', 5);
      expect(await redis.get('probe')).toBe('1');
    } finally {
      await redis.quit();
    }
  });
});

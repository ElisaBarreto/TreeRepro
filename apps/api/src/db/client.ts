import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export interface DbOptions {
  /** Pool size. Default 10. */
  max?: number;
}

/**
 * @rfc RFC-10 R2, R6
 */
export function createDb(url: string, options: DbOptions = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  return {
    db,
    close: async (): Promise<void> => {
      await client.end();
    },
  };
}

export type Db = ReturnType<typeof createDb>['db'];
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | DbTransaction;

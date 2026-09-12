import { TransactionRollbackError } from 'drizzle-orm';
import { afterAll, beforeAll, inject } from 'vitest';
import { createDb, type Db, type DbTransaction } from '../../src/db/client.ts';

/** Opens a pool for the current test file and closes it afterwards. */
export function useTestDb(): { readonly db: Db } {
  let handle: ReturnType<typeof createDb> | undefined;
  beforeAll(() => {
    handle = createDb(inject('databaseUrl'), { max: 2 });
  });
  afterAll(async () => {
    await handle?.close();
  });
  return {
    get db(): Db {
      if (!handle) throw new Error('useTestDb: pool not initialised');
      return handle.db;
    },
  };
}

/** Runs fn inside a transaction that is always rolled back (RFC-01 R4). */
export async function withRollback<T>(db: Db, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let completed = false;
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      completed = true;
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  if (!completed) throw new Error('withRollback: callback did not complete');
  return result as T;
}

/** Rethrows the root cause of a rejected database promise. Drizzle wraps driver errors in DrizzleQueryError; the PostgresError is on `.cause`. */
export async function unwrapDbError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    let cause: unknown = error;
    while (cause instanceof Error && cause.cause instanceof Error) cause = cause.cause;
    throw cause;
  }
}

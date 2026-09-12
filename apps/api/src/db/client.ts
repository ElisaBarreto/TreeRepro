import { DrizzleQueryError } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export interface DbOptions {
  /** Pool size. Default 10. */
  max?: number;
}

type UnknownFn = (...args: unknown[]) => unknown;

/**
 * A failed statement inside a transaction (for example a trigger's
 * `RAISE EXCEPTION`, as used by the audit_log append-only guard) is wrapped
 * by Drizzle 0.45 into a generic `DrizzleQueryError` whose message is just
 * "Failed query: ..."; the useful message lives on `.cause`. This unwraps
 * it for `transaction()` and every nested (savepoint) `transaction()` call,
 * so callers see the real database error message. The wrapped object's
 * type is otherwise untouched, so `Db`/`DbTransaction` keep their normal
 * Drizzle-inferred shape.
 */
function withReadableTransactionErrors<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver): unknown {
      const value: unknown = Reflect.get(obj, prop, receiver);
      if (prop !== 'transaction' || typeof value !== 'function') return value;
      const original = value as UnknownFn;
      return async (fn: UnknownFn, ...rest: unknown[]): Promise<unknown> => {
        try {
          return await original.call(
            obj,
            (tx: object) => fn(withReadableTransactionErrors(tx)),
            ...rest,
          );
        } catch (error) {
          if (error instanceof DrizzleQueryError && error.cause instanceof Error) throw error.cause;
          throw error;
        }
      };
    },
  }) as T;
}

/**
 * @rfc RFC-10 R2, R6
 */
export function createDb(url: string, options: DbOptions = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });
  const rawDb = drizzle(client, { schema });
  const db: typeof rawDb = withReadableTransactionErrors(rawDb);
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

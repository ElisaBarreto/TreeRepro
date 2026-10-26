import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { AppError } from './errors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Keyset cursor over a UUID v7 primary key (RFC-02 R8): the last id of a page,
 * base64url so clients treat it as opaque.
 * @rfc RFC-11 R6
 */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

/** @rfc RFC-11 R6 */
export function decodeCursor(token: string): string {
  const id = Buffer.from(token, 'base64url').toString('utf8');
  if (!UUID.test(id) || encodeCursor(id) !== token) {
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'cursor', message: 'Invalid cursor' },
    ]);
  }
  return id;
}

const invalidCursor = () =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [
    { path: 'cursor', message: 'Invalid cursor' },
  ]);

/** A composite cursor part shaped like a UUID (reuses {@link decodeCursor}'s pattern). @rfc RFC-11 R6 */
export function isUuid(part: string): boolean {
  return UUID.test(part);
}

/** A composite cursor part made only of ASCII digits (a `bigserial` row number). @rfc RFC-11 R6 */
export function isDigits(part: string): boolean {
  return /^\d+$/.test(part);
}

/**
 * Keyset cursor over several sort columns (name then id, row_no then id):
 * the JSON array of the last row's values, base64url so clients treat it as
 * opaque. Callers compare with a row-value predicate, `(a, b) > ($1, $2)`.
 * @rfc RFC-11 R6
 */
export function encodeCompositeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/**
 * Decodes a composite cursor, optionally validating each part (one validator
 * per position, e.g. {@link isUuid} for a uuid part) — a tampered token whose
 * shape is otherwise valid JSON must still fail with 400, not reach the SQL
 * cast that would throw a raw driver error.
 * @rfc RFC-11 R6
 */
export function decodeCompositeCursor(
  token: string,
  arity: number,
  validators?: ((part: string) => boolean)[],
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== arity ||
    !parsed.every((p) => typeof p === 'string') ||
    encodeCompositeCursor(parsed) !== token
  ) {
    throw invalidCursor();
  }
  if (
    validators &&
    (validators.length !== arity || !parsed.every((p, i) => validators[i]?.(p) === true))
  ) {
    throw invalidCursor();
  }
  return parsed;
}

/**
 * The limit + 1 tail every keyset list shares: `rows` were fetched with
 * `limit + 1`; the page is the first `limit` of them and the cursor of the
 * page's last row is emitted only when a row beyond the page proved there
 * is more.
 * @rfc RFC-11 R6
 */
export function pageOf<Row>(
  rows: Row[],
  limit: number,
  cursorOf: (last: Row) => string,
): { page: Row[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: rows.length > limit && last ? cursorOf(last) : null };
}

/**
 * A column a list sorts by (RFC-11 R10): an expression that is never null —
 * coalesce an optional column to the value that should sort first — and the
 * type its cursor value is read back as.
 * @rfc RFC-11 R10
 */
export interface SortKey {
  expr: SQL;
  /** `uuid` for a time-ordered UUID v7 id standing in for its creation time. */
  type: 'text' | 'int' | 'numeric' | 'timestamptz' | 'uuid';
}

const KEY_PART: Record<SortKey['type'], (part: string) => boolean> = {
  text: () => true,
  int: (part) => /^-?\d{1,18}$/.test(part),
  numeric: (part) => part.trim() !== '' && Number.isFinite(Number(part)),
  timestamptz: (part) => !Number.isNaN(Date.parse(part)),
  uuid: isUuid,
};

/**
 * The keyset of a sorted list (RFC-11 R10): `orderBy` (the column, then `id`,
 * both in `order`), the cursor predicate when `cursor` is given, the `key` to
 * select as text for the next cursor, and `cursorOf` to mint it. The cursor
 * is `[sort:order, key, id]`; one minted under another sort or order fails as
 * any bad cursor does. The key travels as Postgres's own text, so a
 * timestamp keeps its microseconds and a page boundary never repeats a row.
 * @rfc RFC-11 R6, R10
 */
export function sortedKeyset<K extends string>(input: {
  columns: Record<K, SortKey>;
  sort: K;
  order: 'asc' | 'desc';
  id: SQL | AnyColumn;
  cursor?: string;
}): {
  where: SQL | undefined;
  orderBy: SQL[];
  key: SQL<string>;
  cursorOf: (row: { sortKey: string; id: string }) => string;
} {
  const column = input.columns[input.sort];
  const tag = `${input.sort}:${input.order}`;
  const dir = sql.raw(input.order === 'asc' ? 'asc' : 'desc');
  let where: SQL | undefined;
  if (input.cursor) {
    const [, key, id] = decodeCompositeCursor(input.cursor, 3, [
      (part) => part === tag,
      KEY_PART[column.type],
      isUuid,
    ]) as [string, string, string];
    const op = sql.raw(input.order === 'asc' ? '>' : '<');
    // An `int` key is read back as `bigint`, the range its validator accepts,
    // so a large forged value fails as a comparison, never as an overflow.
    const cast = sql.raw(column.type === 'int' ? 'bigint' : column.type);
    where = sql`(${column.expr}, ${input.id}) ${op} (${key}::${cast}, ${id}::uuid)`;
  }
  return {
    where,
    orderBy: [sql`${column.expr} ${dir}`, sql`${input.id} ${dir}`],
    key: sql<string>`(${column.expr})::text`,
    cursorOf: (row) => encodeCompositeCursor([tag, row.sortKey, row.id]),
  };
}

/**
 * One page of rows already in memory, sorted by `key` then `id` (RFC-11 R10)
 * with the cursor shape of {@link sortedKeyset}, `[sort:order, key, id]`.
 * For a column SQL cannot order, such as a name encrypted at rest (RFC-40):
 * the caller loads every matching row and decrypts it first.
 * @rfc RFC-11 R10
 */
export function sortedInMemory<Row extends { id: string }>(
  rows: readonly Row[],
  input: {
    sort: string;
    order: 'asc' | 'desc';
    key: (row: Row) => string;
    cursor?: string;
    limit: number;
  },
): { page: Row[]; nextCursor: string | null } {
  const tag = `${input.sort}:${input.order}`;
  const sign = input.order === 'asc' ? 1 : -1;
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const compare = (aKey: string, aId: string, bKey: string, bId: string) =>
    sign * (collator.compare(aKey, bKey) || (aId < bId ? -1 : aId > bId ? 1 : 0));
  const sorted = [...rows].sort((a, b) => compare(input.key(a), a.id, input.key(b), b.id));
  let rest = sorted;
  if (input.cursor) {
    const [, key, id] = decodeCompositeCursor(input.cursor, 3, [
      (part) => part === tag,
      () => true,
      isUuid,
    ]) as [string, string, string];
    rest = sorted.filter((row) => compare(input.key(row), row.id, key, id) > 0);
  }
  return pageOf(rest, input.limit, (last) =>
    encodeCompositeCursor([tag, input.key(last), last.id]),
  );
}

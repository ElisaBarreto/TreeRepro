import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  levelVisible,
  speciesVisible,
  traitVisible,
  type Visibility,
} from '../access/visibility.ts';
import type { Db } from '../db/client.ts';

/** @rfc RFC-66 R8 */
export const EXPORT_COLUMNS = [
  'family',
  'genus',
  'species',
  'name_source',
  'category',
  'trait',
  'value',
  'unit',
  'level',
  'numeric_value',
  'raw_value',
  'primary_reference',
  'secondary_reference',
  'origin',
  'intent',
  'created_at',
  'record_id',
] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r\n]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A field starting with `=`, `+`, `-`, `@`, tab, CR or LF is interpreted as a
 * formula by spreadsheet software; prefixing it with `'` keeps it inert
 * without changing the value a plain CSV reader sees. Never applied to a
 * plain number, which spreadsheet software never treats as a formula.
 * @rfc RFC-66 R4
 */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One RFC 4180 line, CRLF-terminated. @rfc RFC-66 R4 */
export function csvRow(fields: ReadonlyArray<string | number | null | undefined>): string {
  return `${fields.map(csvField).join(',')}\r\n`;
}

interface ExportRow {
  family: string | null;
  genus: string | null;
  species: string;
  name_source: string;
  category: string;
  trait: string;
  value: string;
  unit: string | null;
  level: string | null;
  numeric_value: string | null;
  raw_value: string | null;
  primary_reference: string | null;
  secondary_reference: string | null;
  origin: string;
  intent: string | null;
  created_at: Date;
  record_id: string;
}

const BATCH = 500;

// Renders the drizzle `sql` template below to text plus positional parameters.
// The dataset reads share one home for the visibility predicates
// (`speciesVisible`, `traitVisible`, `levelVisible`: RFC-33 R2), and those are
// drizzle fragments; the streaming cursor, on the other hand, is postgres.js's.
// So the query is written with drizzle and handed to postgres.js already
// rendered.
const dialect = new PgDialect();

/**
 * Every visible, non-withdrawn record as a CSV stream — the interim export of
 * spec R-1, until plan 13i's `dataset.zip`. A postgres.js cursor feeds a
 * `ReadableStream` batch by batch, so the file is never held in memory; the
 * BOM lets spreadsheet software read UTF-8. `batch` is injectable so tests can
 * force several small batches instead of one that swallows every row.
 * `includePending` mirrors RFC-33 R2's record clause: a record whose
 * `harmonisation` is not `harmonised` is visible only to a viewer holding
 * `records.review`, so the caller resolves that permission and passes it
 * here rather than this function reading permissions itself.
 * @rfc RFC-66 R4, R5, R8
 * @rfc RFC-33 R2, R3
 */
export function recordsCsv(
  db: Db,
  visibility: Visibility,
  options: { batch?: number; includePending?: boolean } = {},
): ReadableStream<Uint8Array> {
  const client = db.$client;
  const encoder = new TextEncoder();
  const includePending = options.includePending ?? false;
  const query = dialect.sqlToQuery(sql`
    select f.name as family, g.name as genus, s.canonical_name as species, s.name_source,
      c.key as category, t.key as trait, r.value_text as value, t.unit, l.key as level,
      r.numeric_value::text as numeric_value, r.raw_value as raw_value,
      case when pr.kind = 'personal_observation' then 'Personal observation' else pr.citation_key end as primary_reference,
      case when sr.kind = 'personal_observation' then 'Personal observation' else sr.citation_key end as secondary_reference,
      r.origin as origin, r.intent as intent, r.created_at as created_at, r.id as record_id
    from trait_records r
    join species s on s.id = r.species_id
    left join genera g on g.id = s.genus_id
    left join families f on f.id = g.family_id
    join traits t on t.id = r.trait_id
    join trait_categories c on c.key = t.category_key
    left join trait_levels l on l.id = r.level_id and ${levelVisible(visibility, sql`l.active`)}
    left join bibliographic_references pr on pr.id = r.primary_reference_id
    left join bibliographic_references sr on sr.id = r.secondary_reference_id
    where not exists (select 1 from record_annotations w
                      where w.record_id = r.id and w.kind = 'withdraw')
      and (r.level_id is null or l.id is not null)
      and (r.harmonisation = 'harmonised' or ${includePending ? sql`true` : sql`false`})
      and ${speciesVisible(visibility, sql`s.active`, sql`s.id`)}
      and ${traitVisible(visibility, sql`t.active`)}
    order by f.name nulls last, g.name nulls last, s.canonical_name, t.key, r.id`);
  // `unsafe` only in postgres.js's sense of "text I did not template": the
  // text is the constant above with `$n` placeholders, and every value —
  // the viewer's plot ids — travels as a bound parameter.
  const cursor = client
    .unsafe<ExportRow[]>(query.sql, query.params as Parameters<typeof client.unsafe>[1])
    .cursor(options.batch ?? BATCH);
  const batches = cursor[Symbol.asyncIterator]();
  // postgres.js's cursor iterator implements `return()` as "resolve the
  // previous batch's continuation with CLOSE"; `next()` consumes that
  // continuation before starting its own fetch. So a `cancel()` that fires
  // while a `next()` is in flight (the Web Streams `cancel()` a client abort
  // triggers, per @hono/node-server, while `pull()` awaits `batches.next()`)
  // finds nothing left to resolve: the arriving batch then awaits a
  // continuation nobody resolves, and the pooled connection never comes
  // back. `inflight` lets `cancel()` wait for that fetch first — the same
  // thing a plain `for await` loop gets for free.
  let inflight: Promise<IteratorResult<ExportRow[]>> | null = null;
  const toLine = (r: ExportRow) =>
    csvRow([
      r.family,
      r.genus,
      r.species,
      r.name_source,
      r.category,
      r.trait,
      r.value,
      r.unit,
      r.level,
      r.numeric_value,
      r.raw_value,
      r.primary_reference,
      r.secondary_reference,
      r.origin,
      r.intent,
      new Date(r.created_at).toISOString(),
      r.record_id,
    ]);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${csvRow(EXPORT_COLUMNS)}`));
    },
    async pull(controller) {
      inflight = batches.next();
      let next: IteratorResult<ExportRow[]>;
      try {
        next = await inflight;
      } finally {
        inflight = null;
      }
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value.map(toLine).join('')));
    },
    async cancel() {
      if (inflight) await inflight.catch(() => undefined);
      await batches.return?.();
    },
  });
}

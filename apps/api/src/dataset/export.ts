import type { Db } from '../db/client.ts';

/** @rfc RFC-66 R2 */
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
  'primary_reference',
  'secondary_reference',
  'decided_at',
  'record_id',
] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A field starting with `=`, `+`, `-`, `@`, tab or CR is interpreted as a
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
  primary_reference: string | null;
  secondary_reference: string | null;
  decided_at: Date;
  record_id: string;
}

const BATCH = 500;

/**
 * The current accepted value per species and trait as a CSV stream: a
 * postgres.js cursor feeds a `ReadableStream` batch by batch, so the file is
 * never held in memory. The BOM lets spreadsheet software read UTF-8.
 * `batch` is injectable so tests can force several small batches instead of
 * one that swallows every row.
 * @rfc RFC-66 R2, R3, R4, R5
 */
export function acceptedCsv(db: Db, options: { batch?: number } = {}): ReadableStream<Uint8Array> {
  const client = db.$client;
  const encoder = new TextEncoder();
  const cursor = client<ExportRow[]>`
    with current as (
      select distinct on (a.species_id, a.trait_id)
        a.species_id, a.trait_id, a.record_id, a.decision, a.created_at
      from accepted_values a
      order by a.species_id, a.trait_id, a.id desc)
    select f.name as family, g.name as genus, s.canonical_name as species, s.name_source,
      c.key as category, t.key as trait, r.value_text as value, t.unit, l.key as level,
      r.numeric_value::text as numeric_value,
      case when pr.kind = 'personal_observation' then 'Personal observation' else pr.citation_key end as primary_reference,
      case when sr.kind = 'personal_observation' then 'Personal observation' else sr.citation_key end as secondary_reference,
      cur.created_at as decided_at, r.id as record_id
    from current cur
    join trait_records r on r.id = cur.record_id
    join species s on s.id = cur.species_id
    left join genera g on g.id = s.genus_id
    left join families f on f.id = g.family_id
    join traits t on t.id = cur.trait_id
    join trait_categories c on c.key = t.category_key
    left join trait_levels l on l.id = r.level_id
    left join bibliographic_references pr on pr.id = r.primary_reference_id
    left join bibliographic_references sr on sr.id = r.secondary_reference_id
    where cur.decision = 'accepted'
    order by f.name nulls last, g.name nulls last, s.canonical_name, t.key`.cursor(
    options.batch ?? BATCH,
  );
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
      r.primary_reference,
      r.secondary_reference,
      new Date(r.decided_at).toISOString(),
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

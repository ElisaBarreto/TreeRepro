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

function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
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
 * @rfc RFC-66 R2, R3, R4, R5
 */
export function acceptedCsv(db: Db): ReadableStream<Uint8Array> {
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
      pr.citation_key as primary_reference, sr.citation_key as secondary_reference,
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
    order by f.name nulls last, g.name nulls last, s.canonical_name, t.key`.cursor(BATCH);
  const batches = cursor[Symbol.asyncIterator]();
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
      const next = await batches.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value.map(toLine).join('')));
    },
    async cancel() {
      await batches.return?.();
    },
  });
}

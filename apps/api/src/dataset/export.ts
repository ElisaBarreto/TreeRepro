import { Readable } from 'node:stream';
import type { RecordOrigin } from '@treerepro/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ZipFile } from 'yazl';
import { speciesVisible, traitVisible, type Visibility } from '../access/visibility.ts';
import type { Db } from '../db/client.ts';
import { getPii } from '../security/pii.ts';
import {
  contestCountSql,
  contestVisibleSql,
  contestWithdrawnSql,
  recordContestedSql,
  recordFullyVisible,
} from './contests.ts';
import { recordVisible } from './records.ts';

/** @rfc RFC-66 R2 */
export const RECORD_COLUMNS = [
  'record_code',
  'family',
  'genus',
  'species',
  'name_source',
  'category',
  'trait',
  'unit',
  'level',
  'value_single',
  'value_min',
  'value_max',
  'value_mean',
  'value_sd',
  'value_n',
  'raw_value',
  'references',
  'origin',
  'intent',
  'responds_to',
  'contested',
  'n_validations',
  'n_contests',
  'created_at',
] as const;

/** User names only, never e-mail addresses (RFC-40). @rfc RFC-66 R2 */
export const ANNOTATION_COLUMNS = [
  'record_code',
  'kind',
  'user_name',
  'date',
  'reference',
  'contest_record_code',
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

/** `all` is the whole dataset; `platform` keeps the `TR_` records of records.csv. @rfc RFC-66 R9 */
export type ExportScope = 'all' | 'platform';

/**
 * `batch` is injectable so tests can force several small batches instead of
 * one that swallows every row.
 * @rfc RFC-66 R5, R9
 */
export interface ExportOptions {
  scope: ExportScope;
  batch?: number;
}

const BATCH = 500;

// Renders the drizzle `sql` templates below to text plus positional
// parameters. The visibility predicates (RFC-33 R2) and the contest states
// (RFC-63 R14) are drizzle fragments; the streaming cursor, on the other
// hand, is postgres.js's. So each query is written with drizzle and handed to
// postgres.js already rendered.
const dialect = new PgDialect();

/**
 * A query as a CSV stream: a postgres.js cursor feeds a `ReadableStream`
 * batch by batch, so the file is never held in memory. The BOM lets
 * spreadsheet software read UTF-8.
 */
function csvStream<Row extends object>(
  db: Db,
  query: SQL,
  header: readonly string[],
  toLine: (row: Row) => string,
  batch: number,
): ReadableStream<Uint8Array> {
  const client = db.$client;
  const encoder = new TextEncoder();
  const rendered = dialect.sqlToQuery(query);
  // `unsafe` only in postgres.js's sense of "text I did not template": the
  // text is a constant with `$n` placeholders, and every value — the
  // viewer's plot ids — travels as a bound parameter.
  const cursor = client
    .unsafe<Row[]>(rendered.sql, rendered.params as Parameters<typeof client.unsafe>[1])
    .cursor(batch);
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
  let inflight: Promise<IteratorResult<Row[]>> | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`﻿${csvRow(header)}`));
    },
    async pull(controller) {
      inflight = batches.next();
      let next: IteratorResult<Row[]>;
      try {
        next = await inflight;
      } finally {
        inflight = null;
      }
      if (next.done) {
        controller.close();
        return;
      }
      let text: string;
      try {
        text = next.value.map(toLine).join('');
      } catch (err) {
        // A throwing `pull()` errors the stream without calling `cancel()`,
        // so the cursor would wait forever for this batch's continuation.
        await batches.return?.();
        throw err;
      }
      controller.enqueue(encoder.encode(text));
    },
    async cancel() {
      if (inflight) await inflight.catch(() => undefined);
      await batches.return?.();
    },
  });
}

/**
 * Record `r`, joined to its species `s` and trait `t`, is visible to the
 * viewer: live, harmonised or reviewed, on a visible level, species and trait.
 */
function visibleRecord(v: Visibility): SQL {
  return sql`${speciesVisible(v, sql`s.active`, sql`s.id`)}
    and ${traitVisible(v, sql`t.active`)}
    and ${recordVisible(v, sql`r.id`, sql`r.harmonisation`)}`;
}

/** A reference as the export prints it: its citation key, or `Personal observation`. */
const REF_LABEL = sql`case when b.kind = 'personal_observation' then 'Personal observation' else b.citation_key end`;

/** Record `r`'s references, `; `-joined: primary, secondary, then `record_references` (RFC-63 R16). */
const REFERENCES_OF_R = sql`(select string_agg(${REF_LABEL}, '; ' order by x.pos, b.citation_key)
  from (select r.primary_reference_id as id, 0 as pos
        union all select r.secondary_reference_id, 1
        union all select rr.reference_id, 2 from record_references rr where rr.record_id = r.id) x
  join bibliographic_references b on b.id = x.id)`;

interface RecordRow {
  record_code: string;
  family: string | null;
  genus: string | null;
  species: string;
  name_source: string;
  category: string;
  trait: string;
  unit: string | null;
  level: string | null;
  value_single: string | null;
  value_min: string | null;
  value_max: string | null;
  value_mean: string | null;
  value_sd: string | null;
  value_n: number | null;
  raw_value: string | null;
  refs: string | null;
  origin: string;
  intent: string | null;
  responds_to: string | null;
  contested: boolean;
  n_validations: number;
  n_contests: number;
  created_at: Date;
}

/**
 * `records.csv`: every record visible to the viewer, pending ones (for a
 * reviewer) with their raw value; `platform` keeps the `TR_` records.
 * `contested` and `n_contests` are RFC-63 R14's, `n_validations` counts
 * distinct validators (RFC-63 R8).
 * @rfc RFC-66 R2, R3, R4, R5, R9
 * @rfc RFC-33 R2, R3
 */
export function recordsCsv(
  db: Db,
  visibility: Visibility,
  options: ExportOptions,
): ReadableStream<Uint8Array> {
  const query = sql`
    select r.record_code, f.name as family, g.name as genus, s.canonical_name as species, s.name_source,
      c.key as category, t.key as trait, t.unit, l.key as level,
      r.numeric_value::text as value_single, r.min_value::text as value_min,
      r.max_value::text as value_max, r.mean_value::text as value_mean,
      r.sd_value::text as value_sd, r.n as value_n,
      coalesce(r.raw_value, case when r.harmonisation <> 'harmonised' then r.value_text end) as raw_value,
      ${REFERENCES_OF_R} as refs,
      r.origin, r.intent,
      (select x.record_code from trait_records x where x.id = r.responds_to_record_id) as responds_to,
      ${recordContestedSql(visibility, sql`r.id`)} as contested,
      (select count(distinct a.actor_id) from record_annotations a
        where a.record_id = r.id and a.kind = 'confirm')::int as n_validations,
      ${contestCountSql(sql`r.id`)} as n_contests,
      r.created_at
    from trait_records r
    join species s on s.id = r.species_id
    left join genera g on g.id = s.genus_id
    left join families f on f.id = g.family_id
    join traits t on t.id = r.trait_id
    join trait_categories c on c.key = t.category_key
    left join trait_levels l on l.id = r.level_id
    where ${visibleRecord(visibility)}
      and ${options.scope === 'platform' ? sql`r.origin = 'manual'` : sql`true`}
    order by f.name nulls last, g.name nulls last, s.canonical_name, t.key, r.record_code`;
  return csvStream<RecordRow>(
    db,
    query,
    RECORD_COLUMNS,
    (r) =>
      csvRow([
        r.record_code,
        r.family,
        r.genus,
        r.species,
        r.name_source,
        r.category,
        r.trait,
        r.unit,
        r.level,
        r.value_single,
        r.value_min,
        r.value_max,
        r.value_mean,
        r.value_sd,
        r.value_n,
        r.raw_value,
        r.refs,
        r.origin,
        r.intent,
        r.responds_to,
        r.contested ? 'true' : 'false',
        r.n_validations,
        r.n_contests,
        new Date(r.created_at).toISOString(),
      ]),
    options.batch ?? BATCH,
  );
}

interface AnnotationRow {
  record_code: string;
  kind: 'validation' | 'contest';
  /** Ciphertext (RFC-40 R2): the raw cursor bypasses `encryptedText`. */
  user_name: string;
  date: Date;
  reference: string | null;
  contest_record_code: string | null;
}

/**
 * The rows of `annotations.csv`, in R3 order, `user_name` still encrypted:
 * one per validation (`confirm`) on a visible record, and one per contest
 * that is neither withdrawn nor hidden (RFC-33 R2) and per visible record it
 * contests — every record of a level a categorical contest names, or the
 * record a quantitative contest responds to. `contest_record_code` lists the
 * contest's created records the viewer can see, so a withdrawn or hidden
 * record never leaks its code. `recordOrigin` keeps the rows whose
 * validated or contested record has that origin.
 * @rfc RFC-66 R2, R3
 * @rfc RFC-33 R2
 */
export function annotationRowsQuery(
  visibility: Visibility,
  options: { recordOrigin?: RecordOrigin } = {},
): SQL {
  const origin = options.recordOrigin ? sql`r.origin = ${options.recordOrigin}` : sql`true`;
  return sql`
    select x.record_code, x.kind, x.user_name, x.date, x.reference, x.contest_record_code from (
      select r.record_code, 'validation' as kind, u.name as user_name, a.created_at as date,
        ${REF_LABEL} as reference, null::text as contest_record_code, a.id as seq
      from record_annotations a
      join trait_records r on r.id = a.record_id
      join species s on s.id = r.species_id
      join traits t on t.id = r.trait_id
      join users u on u.id = a.actor_id
      left join bibliographic_references b on b.id = a.reference_id
      where a.kind = 'confirm' and ${visibleRecord(visibility)} and ${origin}
      union all
      select r.record_code, 'contest', u.name, k.created_at, null,
        (select string_agg(kc_r.record_code, '; ' order by kc_r.record_code)
          from contest_records kc join trait_records kc_r on kc_r.id = kc.record_id
          where kc.contest_id = k.id and ${recordFullyVisible(visibility, sql`kc_r.id`)}),
        k.id
      from contests k
      join lateral (
        select kt_r.id from contest_levels kt_l
          join trait_records kt_r on kt_r.species_id = k.species_id and kt_r.trait_id = k.trait_id
            and kt_r.level_id = kt_l.level_id
          where kt_l.contest_id = k.id
        union
        select kt_q.responds_to_record_id from contest_records kt_c
          join trait_records kt_q on kt_q.id = kt_c.record_id
          where kt_c.contest_id = k.id and kt_q.responds_to_record_id is not null
      ) target on true
      join trait_records r on r.id = target.id
      join species s on s.id = r.species_id
      join traits t on t.id = r.trait_id
      join users u on u.id = k.created_by
      where not ${contestWithdrawnSql('k')} and ${contestVisibleSql(visibility, sql`k.id`)}
        and ${visibleRecord(visibility)} and ${origin}
    ) x
    order by x.record_code, x.date, x.seq`;
}

/**
 * `annotations.csv`, the same for both scopes: the importer writes no
 * validation or contest, so every row is a user's (RFC-66 R9). `user_name`
 * is decrypted here, in the API process (RFC-40 R8); no e-mail is ever read.
 * @rfc RFC-66 R2, R3, R4, R5, R9
 * @rfc RFC-33 R2, R3
 * @rfc RFC-40 R8
 */
export function annotationsCsv(
  db: Db,
  visibility: Visibility,
  options: ExportOptions,
): ReadableStream<Uint8Array> {
  const pii = getPii();
  return csvStream<AnnotationRow>(
    db,
    annotationRowsQuery(visibility),
    ANNOTATION_COLUMNS,
    (r) =>
      csvRow([
        r.record_code,
        r.kind,
        pii.decrypt(r.user_name, 'users.name'),
        new Date(r.date).toISOString(),
        r.reference,
        r.contest_record_code,
      ]),
    options.batch ?? BATCH,
  );
}

/**
 * The full dataset as one ZIP: `records.csv`, then `annotations.csv`,
 * deflated. yazl pumps its entries one at a time and opens the lazy one only
 * when its turn comes, so the two cursors never hold two pooled connections
 * at once. ZIP64 is written as soon as a size or offset needs it. A client
 * abort cancels the returned stream, which destroys yazl's output; that
 * `close` destroys the entry being pumped, which cancels its cursor (the
 * `cancel()` of `csvStream`). A failing query destroys the output with the
 * error, so the download ends cut short instead of looking complete. yazl
 * attaches no `error` listener to its input, so this function attaches one.
 * @rfc RFC-66 R4, R5
 */
export function datasetZip(
  db: Db,
  visibility: Visibility,
  options: ExportOptions & { now: Date },
): ReadableStream<Uint8Array> {
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  let current: Readable | null = null;
  const entry = (name: string, csv: () => ReadableStream<Uint8Array>) => {
    zip.addReadStreamLazy(name, { mtime: options.now }, (cb) => {
      // The client left before this entry's turn: open no cursor for it.
      if (output.destroyed) return cb(new Error('aborted'), undefined as unknown as Readable);
      const source = Readable.fromWeb(csv());
      source.once('error', (err) => output.destroy(err));
      current = source;
      cb(null, source);
    });
  };
  entry('records.csv', () => recordsCsv(db, visibility, options));
  entry('annotations.csv', () => annotationsCsv(db, visibility, options));
  zip.once('error', (err: Error) => output.destroy(err));
  output.once('close', () => current?.destroy());
  zip.end();
  return Readable.toWeb(output);
}

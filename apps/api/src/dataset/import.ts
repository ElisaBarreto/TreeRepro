import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  HarmonisationStatus,
  ImportBatch,
  ImportReject,
  ImportRejectReason,
  UserRef,
} from '@treerepro/contracts';
import { and, asc, count, desc, sql as dsql, eq, lt } from 'drizzle-orm';
import postgres from 'postgres';
import type { Db, DbExecutor } from '../db/client.ts';
import { traits } from '../db/schema/dictionary.ts';
import { type ImportBatchRow, importBatches, importRejects } from '../db/schema/imports.ts';
import { traitRecords } from '../db/schema/records.ts';
import { users } from '../db/schema/users.ts';
import {
  decodeCompositeCursor,
  decodeCursor,
  encodeCompositeCursor,
  encodeCursor,
  isDigits,
  isUuid,
  pageOf,
} from '../http/cursor.ts';

/** The 15 columns of the compiled dataset, in file order. @rfc RFC-64 R2 */
export const IMPORT_COLUMNS = [
  'primary_reference',
  'secondary_reference',
  'wcvp_species',
  'wcvp_genus',
  'wcvp_family',
  'gbif_species',
  'gbif_usage_key',
  'original_species_name',
  'secondary_source_species_name',
  'original_trait_name',
  'final_standard_trait',
  'broad_category',
  'original_value_clean',
  'trait_value_type',
  'harmonised_value',
] as const;

/** A number as the importer accepts it; the SQL below uses the same expression. @rfc RFC-64 R6 */
export const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** How long a COPY may go without the writable accepting a new chunk before it's considered stuck; injectable via {@link ImportInput.copyIdleTimeoutMs} for tests. @rfc RFC-64 R9 */
const DEFAULT_COPY_IDLE_TIMEOUT_MS = 60_000;
const NUMBER_PATTERN_SQL = '^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$';

/**
 * Streams `source` into `destination`, aborting once `destination` has gone
 * `idleTimeoutMs` without accepting a chunk — not once the whole transfer
 * has taken too long, since a real dataset file is millions of rows and the
 * COPY itself can legitimately run for minutes.
 *
 * This guards against a real hang in postgres.js 3.4.9's `.writable()` COPY
 * stream (verified directly against the driver, outside Drizzle): `.writable()`
 * runs COPY over the simple query protocol. On a row that violates the COPY
 * format, the server answers `ErrorResponse` + `ReadyForQuery`, but the
 * client only resolves the write from its `CommandComplete` handler, which
 * is also the sole place that invokes the `final()` callback stored when we
 * call `.end()` (which sends `CopyDone`). `CommandComplete` never arrives on
 * the error path, so if `.end()` is called before the driver has processed
 * the server's error, the writable neither errors nor finishes — the pipeline
 * hangs forever, silently, with no event ever firing on either stream. A
 * `PassThrough` sits between `source` and `destination` purely so we can
 * observe every chunk that reaches the destination side and re-arm the idle
 * timer; once nothing has moved for `idleTimeoutMs` we abort, which reliably
 * unblocks the driver (a `.destroy()`, sending `CopyFail`) even when the
 * error path above is stuck.
 * @rfc RFC-64 R9
 */
async function pipelineWithIdleGuard(
  source: NodeJS.ReadableStream,
  destination: NodeJS.WritableStream,
  idleTimeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const watcher = new PassThrough();
  let timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  watcher.on('data', arm);
  try {
    await pipeline(source, watcher, destination, { signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(
        `COPY made no progress for ${idleTimeoutMs}ms; the file likely has a row that violates the column count or format`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    watcher.off('data', arm);
  }
}

/** Unwraps the driver's `PostgresError`, including one hop through Drizzle's `DrizzleQueryError.cause`. */
function toPostgresError(err: unknown): InstanceType<typeof postgres.PostgresError> | undefined {
  if (err instanceof postgres.PostgresError) return err;
  if (err instanceof Error && err.cause instanceof postgres.PostgresError) return err.cause;
  return undefined;
}

/** Keeps `detail` and `where` alongside the message — on an 8M-row file, `where` ("COPY import_staging, line 12345: ...") is often the only thing that pinpoints the bad row. @rfc RFC-64 R9 */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const pg = toPostgresError(err);
  return [message, pg?.detail, pg?.where].filter(Boolean).join(' — ').slice(0, 2000);
}

/** Why an import did not start. @rfc RFC-64 R2, R3 */
export class ImportRefusedError extends Error {
  readonly reason: 'dictionary_empty' | 'header_mismatch' | 'already_imported';
  readonly batchId: string | undefined;

  constructor(
    reason: 'dictionary_empty' | 'header_mismatch' | 'already_imported',
    message: string,
    batchId?: string,
  ) {
    super(message);
    this.name = 'ImportRefusedError';
    this.reason = reason;
    this.batchId = batchId;
  }
}

/** Minimal RFC 4180 record parser for the header line only; Postgres parses the data. @rfc RFC-64 R2 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** @rfc RFC-64 R2 */
export function validateHeader(line: string): void {
  const columns = parseCsvLine(line.replace(/^\uFEFF/, '').replace(/\r$/, '')).map((c) => c.trim());
  const same =
    columns.length === IMPORT_COLUMNS.length && columns.every((c, i) => c === IMPORT_COLUMNS[i]);
  if (!same) {
    throw new ImportRefusedError(
      'header_mismatch',
      `Unexpected header. Expected: ${IMPORT_COLUMNS.join(',')}. Got: ${columns.join(',')}`,
    );
  }
}

/** Refuses a header line with no newline within this many bytes, rather than buffering an unbounded amount of a non-CSV file. @rfc RFC-64 R2 */
const MAX_FIRST_LINE_BYTES = 64 * 1024;

/** First line of a file without reading the rest. @rfc RFC-64 R2 */
export async function readFirstLine(path: string): Promise<string> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk as string;
    const nl = buffer.indexOf('\n');
    if (nl >= 0) {
      stream.destroy();
      return buffer.slice(0, nl);
    }
    if (Buffer.byteLength(buffer, 'utf8') > MAX_FIRST_LINE_BYTES) {
      stream.destroy();
      throw new ImportRefusedError(
        'header_mismatch',
        'The first line is longer than 64 KiB; is this a CSV with LF or CRLF line endings?',
      );
    }
  }
  return buffer;
}

/** @rfc RFC-64 R3 */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** @rfc RFC-64 R11 */
export function toImportBatch(row: ImportBatchRow, runBy: UserRef | null): ImportBatch {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSha256: row.fileSha256,
    status: row.status,
    runBy,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    rowsTotal: row.rowsTotal,
    rowsInserted: row.rowsInserted,
    rowsDuplicate: row.rowsDuplicate,
    rowsRejected: row.rowsRejected,
    rowsPending: row.rowsPending,
    unknownLevels: row.unknownLevels,
    error: row.error,
  };
}

const batchWithRunBy = {
  batch: importBatches,
  runById: users.id,
  runByName: users.name,
};

function fromJoined(row: {
  batch: ImportBatchRow;
  runById: string | null;
  runByName: string | null;
}) {
  return toImportBatch(
    row.batch,
    row.runById && row.runByName ? { id: row.runById, name: row.runByName } : null,
  );
}

/** @rfc RFC-64 R11 */
export async function getImportBatch(db: DbExecutor, id: string): Promise<ImportBatch | null> {
  const [row] = await db
    .select(batchWithRunBy)
    .from(importBatches)
    .leftJoin(users, eq(users.id, importBatches.runBy))
    .where(eq(importBatches.id, id))
    .limit(1);
  return row ? fromJoined(row) : null;
}

/** Newest first by id (UUID v7). @rfc RFC-64 R11 */
export async function listImportBatches(
  db: DbExecutor,
  input: { cursor?: string; limit: number },
): Promise<{ data: ImportBatch[]; nextCursor: string | null }> {
  const rows = await db
    .select(batchWithRunBy)
    .from(importBatches)
    .leftJoin(users, eq(users.id, importBatches.runBy))
    .where(input.cursor ? lt(importBatches.id, decodeCursor(input.cursor)) : undefined)
    .orderBy(desc(importBatches.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.batch.id));
  return { data: page.map(fromJoined), nextCursor };
}

/** By row number ascending; composite cursor (row_no, id). @rfc RFC-64 R11 */
export async function listImportRejects(
  db: DbExecutor,
  input: { batchId: string; cursor?: string; limit: number },
): Promise<{ data: ImportReject[]; nextCursor: string | null }> {
  const conditions = [eq(importRejects.batchId, input.batchId)];
  if (input.cursor) {
    const [rowNo, id] = decodeCompositeCursor(input.cursor, 2, [isDigits, isUuid]) as [
      string,
      string,
    ];
    conditions.push(
      dsql`(${importRejects.rowNo}, ${importRejects.id}) > (${Number(rowNo)}::bigint, ${id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(importRejects)
    .where(and(...conditions))
    .orderBy(asc(importRejects.rowNo), asc(importRejects.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([String(r.rowNo), r.id]),
  );
  return {
    data: page.map((r) => ({ id: r.id, rowNo: r.rowNo, reason: r.reason, rawRow: r.rawRow })),
    nextCursor,
  };
}

/** Counts for the terminal report. @rfc RFC-64 R10 */
export async function batchReport(
  db: DbExecutor,
  batchId: string,
): Promise<{
  harmonisation: Record<HarmonisationStatus, number>;
  rejectReasons: Record<ImportRejectReason, number>;
}> {
  const harmonisation: Record<HarmonisationStatus, number> = {
    harmonised: 0,
    unknown_level: 0,
    multi_value: 0,
    not_numeric: 0,
    empty: 0,
  };
  const rejectReasons: Record<ImportRejectReason, number> = {
    no_species_name: 0,
    unknown_trait: 0,
    no_reference: 0,
  };
  const h = await db
    .select({ status: traitRecords.harmonisation, n: count() })
    .from(traitRecords)
    .where(eq(traitRecords.importBatchId, batchId))
    .groupBy(traitRecords.harmonisation);
  for (const row of h) harmonisation[row.status] = row.n;
  const r = await db
    .select({ reason: importRejects.reason, n: count() })
    .from(importRejects)
    .where(eq(importRejects.batchId, batchId))
    .groupBy(importRejects.reason);
  for (const row of r) rejectReasons[row.reason] = row.n;
  return { harmonisation, rejectReasons };
}

export interface ImportInput {
  filePath: string;
  /** User id of the administrator running the import; null when unknown. */
  runBy?: string | null;
  /** Import a file whose hash was already completed. */
  force?: boolean;
  /** See {@link pipelineWithIdleGuard}. Default {@link DEFAULT_COPY_IDLE_TIMEOUT_MS}; tests lower it to fail fast. */
  copyIdleTimeoutMs?: number;
}

/**
 * Streams the CSV into a temporary table with COPY, then resolves names,
 * harmonises values and inserts records with set-based SQL in one
 * transaction. See RFC-64 for every rule; the SQL follows its order.
 * @rfc RFC-64 R2-R9
 */
export async function importRecords(db: Db, input: ImportInput): Promise<ImportBatch> {
  const [dictionary] = await db.select({ n: count() }).from(traits);
  if (!dictionary || dictionary.n === 0) {
    throw new ImportRefusedError(
      'dictionary_empty',
      'The trait dictionary is empty; run seed:traits first',
    );
  }
  validateHeader(await readFirstLine(input.filePath));
  const fileSha256 = await sha256File(input.filePath);
  if (!input.force) {
    const [done] = await db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(and(eq(importBatches.fileSha256, fileSha256), eq(importBatches.status, 'completed')))
      .limit(1);
    if (done) {
      throw new ImportRefusedError(
        'already_imported',
        `This file was already imported as batch ${done.id}; pass --force to import it again`,
        done.id,
      );
    }
  }
  const [batch] = await db
    .insert(importBatches)
    .values({ fileName: basename(input.filePath), fileSha256, runBy: input.runBy ?? null })
    .returning({ id: importBatches.id });
  if (!batch) throw new Error('importRecords: batch insert returned no row');

  const sql = db.$client;
  try {
    await sql.begin(async (tx) => {
      // R4 staging
      await tx`
        create temporary table import_staging (
          row_no bigserial primary key,
          primary_reference text, secondary_reference text,
          wcvp_species text, wcvp_genus text, wcvp_family text,
          gbif_species text, gbif_usage_key text,
          original_species_name text, secondary_source_species_name text,
          original_trait_name text, final_standard_trait text, broad_category text,
          original_value_clean text, trait_value_type text, harmonised_value text
        ) on commit drop`;
      const writable = await tx`
        copy import_staging (
          primary_reference, secondary_reference, wcvp_species, wcvp_genus, wcvp_family,
          gbif_species, gbif_usage_key, original_species_name, secondary_source_species_name,
          original_trait_name, final_standard_trait, broad_category, original_value_clean,
          trait_value_type, harmonised_value
        ) from stdin with (format csv, header true, encoding 'UTF8')`.writable();
      await pipelineWithIdleGuard(
        createReadStream(input.filePath),
        writable,
        input.copyIdleTimeoutMs ?? DEFAULT_COPY_IDLE_TIMEOUT_MS,
      );
      const [{ total }] = (await tx`select count(*)::int as total from import_staging`) as [
        { total: number },
      ];

      // R5 normalised lookup columns (COPY turns unquoted empty fields into NULL; nullif covers '')
      await tx`
        alter table import_staging
          add column species_name text, add column name_source text,
          add column genus_name text, add column family_name text, add column gbif_name text,
          add column trait_key text, add column primary_key text, add column secondary_key text,
          add column value text`;
      await tx`
        update import_staging set
          species_name = coalesce(
            nullif(trim(regexp_replace(wcvp_species, '\\s+', ' ', 'g')), ''),
            nullif(trim(regexp_replace(gbif_species, '\\s+', ' ', 'g')), ''),
            nullif(trim(regexp_replace(original_species_name, '\\s+', ' ', 'g')), ''),
            nullif(trim(regexp_replace(secondary_source_species_name, '\\s+', ' ', 'g')), '')),
          name_source = case
            when nullif(trim(regexp_replace(wcvp_species, '\\s+', ' ', 'g')), '') is not null
              then 'wcvp'
            when nullif(trim(regexp_replace(gbif_species, '\\s+', ' ', 'g')), '') is not null
              then 'gbif'
            else 'original' end,
          genus_name = nullif(trim(regexp_replace(wcvp_genus, '\\s+', ' ', 'g')), ''),
          family_name = nullif(trim(regexp_replace(wcvp_family, '\\s+', ' ', 'g')), ''),
          gbif_name = nullif(trim(regexp_replace(gbif_species, '\\s+', ' ', 'g')), ''),
          trait_key = nullif(trim(final_standard_trait), ''),
          primary_key = nullif(trim(primary_reference), ''),
          secondary_key = nullif(trim(secondary_reference), ''),
          value = trim(coalesce(harmonised_value, ''))`;
      await tx`create index on import_staging (species_name)`;
      await tx`create index on import_staging (trait_key)`;
      // autovacuum ignores temp tables, so the planner never sees updated
      // stats unless we analyze explicitly (both catalog inserts below rely
      // on the two indexes just created).
      await tx`analyze import_staging`;

      // R5 catalogs: insert what is missing, never touch what exists
      await tx`
        insert into families (name)
        select distinct family_name from import_staging where family_name is not null
        on conflict (name) do nothing`;
      await tx`
        insert into genera (name, family_id)
        select distinct on (s.genus_name) s.genus_name, f.id
        from import_staging s left join families f on f.name = s.family_name
        where s.genus_name is not null
        order by s.genus_name, f.id nulls last
        on conflict (name) do nothing`;
      await tx`
        insert into species (canonical_name, name_source, genus_id)
        select distinct on (s.species_name) s.species_name, s.name_source, g.id
        from import_staging s left join genera g on g.name = s.genus_name
        where s.species_name is not null
        order by s.species_name, (s.name_source = 'wcvp') desc, g.id nulls last
        on conflict (canonical_name) do nothing`;
      await tx`
        insert into species_names (species_id, name, source, gbif_usage_key)
        select distinct on (sp.id, s.gbif_name) sp.id, s.gbif_name, 'gbif', nullif(trim(s.gbif_usage_key), '')
        from import_staging s join species sp on sp.canonical_name = s.species_name
        where s.gbif_name is not null and s.gbif_name <> s.species_name
        order by sp.id, s.gbif_name, s.row_no
        on conflict (species_id, name) do nothing`;
      await tx`
        insert into bibliographic_references (citation_key)
        select distinct k from (
          select primary_key as k from import_staging
          union select secondary_key from import_staging
        ) u where k is not null
        on conflict (citation_key) do nothing`;

      // R7 rejects
      const rejected = await tx`
        insert into import_rejects (batch_id, row_no, reason, raw_row)
        select ${batch.id}, s.row_no,
          case when s.species_name is null then 'no_species_name'
               when t.id is null then 'unknown_trait'
               else 'no_reference' end,
          jsonb_build_object(
            'primary_reference', coalesce(s.primary_reference, ''),
            'secondary_reference', coalesce(s.secondary_reference, ''),
            'wcvp_species', coalesce(s.wcvp_species, ''),
            'wcvp_genus', coalesce(s.wcvp_genus, ''),
            'wcvp_family', coalesce(s.wcvp_family, ''),
            'gbif_species', coalesce(s.gbif_species, ''),
            'gbif_usage_key', coalesce(s.gbif_usage_key, ''),
            'original_species_name', coalesce(s.original_species_name, ''),
            'secondary_source_species_name', coalesce(s.secondary_source_species_name, ''),
            'original_trait_name', coalesce(s.original_trait_name, ''),
            'final_standard_trait', coalesce(s.final_standard_trait, ''),
            'broad_category', coalesce(s.broad_category, ''),
            'original_value_clean', coalesce(s.original_value_clean, ''),
            'trait_value_type', coalesce(s.trait_value_type, ''),
            'harmonised_value', coalesce(s.harmonised_value, ''))
        from import_staging s left join traits t on t.key = s.trait_key
        where s.species_name is null or t.id is null
           or (s.primary_key is null and s.secondary_key is null)`;

      // R6, R8 records
      const inserted = await tx`
        with resolved as (
          select s.row_no, sp.id as species_id, t.id as trait_id, t.value_type, s.value as value_text,
            nullif(trim(s.original_value_clean), '') as raw_value,
            nullif(trim(s.original_trait_name), '') as original_trait_name,
            nullif(trim(s.original_species_name), '') as original_species_name,
            nullif(trim(s.secondary_source_species_name), '') as secondary_source_species_name,
            nullif(trim(s.broad_category), '') as raw_category,
            pr.id as primary_reference_id, sr.id as secondary_reference_id,
            lv.id as level_id,
            case when t.value_type = 'quantitative' and s.value ~ ${NUMBER_PATTERN_SQL}
                 then s.value::numeric end as numeric_value
          from import_staging s
          join species sp on sp.canonical_name = s.species_name
          join traits t on t.key = s.trait_key
          left join bibliographic_references pr on pr.citation_key = s.primary_key
          left join bibliographic_references sr on sr.citation_key = s.secondary_key
          left join trait_levels lv on lv.trait_id = t.id and t.value_type = 'categorical'
                                   and lower(lv.key) = lower(s.value)
          where s.primary_key is not null or s.secondary_key is not null
        )
        insert into trait_records (
          species_id, trait_id, level_id, numeric_value, value_text, harmonisation,
          raw_value, original_trait_name, original_species_name, secondary_source_species_name, raw_category,
          primary_reference_id, secondary_reference_id, origin, import_batch_id, import_row_no)
        select species_id, trait_id, level_id, numeric_value, value_text,
          case when value_text = '' then 'empty'
               when value_type = 'categorical' and level_id is not null then 'harmonised'
               when value_type = 'categorical' and position(';' in value_text) > 0 then 'multi_value'
               when value_type = 'categorical' then 'unknown_level'
               when numeric_value is not null then 'harmonised'
               else 'not_numeric' end,
          raw_value, original_trait_name, original_species_name, secondary_source_species_name, raw_category,
          primary_reference_id, secondary_reference_id, 'import', ${batch.id}, row_no
        from resolved
        order by row_no
        on conflict on constraint trait_records_claim_key do nothing`;

      const [{ pending }] = (await tx`
        select count(*)::int as pending from trait_records
        where import_batch_id = ${batch.id} and harmonisation <> 'harmonised'`) as [
        { pending: number },
      ];
      const unknownLevels = (await tx`
        select t.key as trait, r.value_text as value, count(*)::int as count
        from trait_records r join traits t on t.id = r.trait_id
        where r.import_batch_id = ${batch.id} and r.harmonisation in ('unknown_level', 'multi_value')
        group by t.key, r.value_text
        order by count desc, t.key, r.value_text
        limit 30`) as { trait: string; value: string; count: number }[];

      // Recorded in the same transaction as everything above: a crash between
      // COMMIT and a separate post-commit UPDATE could otherwise leave a
      // fully-imported batch stuck at `running`/`failed` forever.
      await tx`
        update import_batches
        set status = 'completed',
            finished_at = clock_timestamp(),
            rows_total = ${total},
            rows_inserted = ${inserted.count},
            rows_duplicate = ${total - rejected.count - inserted.count},
            rows_rejected = ${rejected.count},
            rows_pending = ${pending},
            unknown_levels = ${JSON.stringify(
              unknownLevels.map((u) => ({ trait: u.trait, value: u.value, count: u.count })),
            )}::jsonb
        where id = ${batch.id}`;
    });
  } catch (err) {
    // R9: the transaction rolled back; keep the batch as the record of the
    // failure. If even this update fails, don't let that secondary error
    // mask the original one — attach it as `cause` and keep throwing `err`.
    try {
      await db
        .update(importBatches)
        .set({ status: 'failed', finishedAt: new Date(), error: describeError(err) })
        .where(eq(importBatches.id, batch.id));
    } catch (updateErr) {
      if (err instanceof Error && err.cause === undefined) err.cause = updateErr;
    }
    throw err;
  }
  const result = await getImportBatch(db, batch.id);
  if (!result) throw new Error('importRecords: batch vanished');
  return result;
}

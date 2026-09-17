import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type { ImportBatch, ImportBatchKind, ImportReject } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import { assertSafeMetadata } from '../../audit/audit.ts';
import type { Db } from '../../db/client.ts';
import { DEFAULT_COPY_IDLE_TIMEOUT_MS, pipelineWithIdleGuard } from '../../db/copy.ts';
import { importBatches } from '../../db/schema/imports.ts';
import {
  getImportBatch,
  ImportRefusedError,
  parseCsvLine,
  readFirstLine,
  sha256File,
} from '../import.ts';

export interface SupplementaryApplyResult {
  inserted: number;
  duplicate: number;
  rejected: number;
}

export interface SupplementaryImportInput {
  kind: ImportBatchKind;
  filePath: string;
  /** The exact header line, as column names. */
  header: readonly string[];
  runBy: string | null;
  copyIdleTimeoutMs?: number;
  /**
   * Runs inside the transaction after staging. Reads `import_staging`
   * (`row_no` plus the header columns, raw text), writes the rows it rejects
   * into `import_rejects` for `batchId`, and answers the counts.
   */
  apply(tx: postgres.TransactionSql, batchId: string): Promise<SupplementaryApplyResult>;
}

/** Identifier-safe: headers are fixed literals in this module's callers. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad column name ${name}`);
  return `"${name}"`;
}

/**
 * Stage, apply, finalise, audit — one transaction (RFC-68 R3–R5). The batch
 * row is created before the transaction so a failure is recorded on it.
 * @rfc RFC-68 R2-R5
 */
export async function runSupplementaryImport(
  db: Db,
  input: SupplementaryImportInput,
): Promise<ImportBatch> {
  const first = parseCsvLine(await readFirstLine(input.filePath)); // RFC-64 R2: the header is a CSV record, quotes allowed
  const expected = [...input.header];
  if (first.length !== expected.length || first.some((c, i) => c !== expected[i])) {
    throw new ImportRefusedError(
      'header_mismatch',
      `Expected header "${expected.join(',')}", got "${first.join(',')}"`,
    );
  }
  const fileSha256 = await sha256File(input.filePath);
  const [batch] = await db
    .insert(importBatches)
    .values({
      fileName: basename(input.filePath),
      fileSha256,
      runBy: input.runBy,
      kind: input.kind,
    })
    .returning({ id: importBatches.id });
  if (!batch) throw new Error('runSupplementaryImport: batch insert returned no row');
  const sql = db.$client;
  try {
    await sql.begin(async (tx) => {
      const cols = input.header.map(ident).join(', ');
      await tx.unsafe(
        `create temporary table import_staging (row_no bigserial primary key, ${input.header
          .map((h) => `${ident(h)} text`)
          .join(', ')}) on commit drop`,
      );
      const writable = await tx
        .unsafe(
          `copy import_staging (${cols}) from stdin with (format csv, header true, encoding 'UTF8')`,
        )
        .writable();
      await pipelineWithIdleGuard(
        createReadStream(input.filePath),
        writable,
        input.copyIdleTimeoutMs ?? DEFAULT_COPY_IDLE_TIMEOUT_MS,
      );
      const [{ total }] = (await tx`select count(*)::int as total from import_staging`) as [
        { total: number },
      ];
      const counts = await input.apply(tx, batch.id);
      await tx`
        update import_batches set status = 'completed', finished_at = clock_timestamp(),
          rows_total = ${total}, rows_inserted = ${counts.inserted}, rows_duplicate = ${counts.duplicate},
          rows_rejected = ${counts.rejected}, rows_pending = 0
        where id = ${batch.id}`;
      // RFC-68 R5 — same transaction (RFC-41 R5). `recordAudit` takes a Drizzle
      // executor and this is a postgres.js transaction, so the row is written
      // with `tx` directly after the same RFC-41 R7 key check `recordAudit` runs.
      const metadata = {
        kind: input.kind,
        rowsTotal: total,
        rowsInserted: counts.inserted,
        rowsDuplicate: counts.duplicate,
        rowsRejected: counts.rejected,
      };
      assertSafeMetadata(metadata);
      await tx`
        insert into audit_log (actor_user_id, action, target_type, target_id, metadata)
        values (${input.runBy}, 'imports.completed', 'import_batches', ${batch.id}, ${JSON.stringify(metadata)}::jsonb)`;
    });
  } catch (err) {
    try {
      await db
        .update(importBatches)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          error: (err as Error).message.slice(0, 2000),
        })
        .where(eq(importBatches.id, batch.id));
    } catch (updateErr) {
      if (err instanceof Error && err.cause === undefined) err.cause = updateErr;
    }
    throw err;
  }
  const result = await getImportBatch(db, batch.id);
  if (!result) throw new Error('runSupplementaryImport: batch vanished');
  return result;
}

/** @rfc RFC-68 R6 */
export function supplementaryReport(
  batch: ImportBatch,
  report: { rejectReasons: Record<string, number> }, // batchReport(db, batch.id) — totals over every reject, not the first 30
  rejects: ImportReject[], // the first 30, for the row numbers
  seconds: string,
): string {
  return [
    `File ${batch.fileName} (sha256 ${batch.fileSha256})`,
    `Batch ${batch.id} (${batch.kind}) completed in ${seconds}s`,
    `Rows: ${batch.rowsTotal} total, ${batch.rowsInserted} applied, ${batch.rowsDuplicate} duplicate, ${batch.rowsRejected} rejected`,
    `Rejections: ${
      Object.entries(report.rejectReasons)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || 'none'
    }`,
    ...rejects.map((r) => `  row ${r.rowNo}: ${r.reason}`),
  ].join('\n');
}

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseCsvLine } from './import.ts';

/** A CSV row keyed by header name. @rfc RFC-77 R9 */
export type CsvRow = Record<string, string>;

/**
 * The rows of a CSV file, one at a time, so the owner's 300 MB summaries are
 * never held whole. Fields may be quoted and hold commas, not line breaks.
 * @rfc RFC-77 R9
 */
export async function* readCsvRows(path: string): AsyncGenerator<CsvRow> {
  let header: string[] | null = null;
  for await (const raw of createInterface({
    input: createReadStream(path, 'utf8'),
    crlfDelay: Infinity,
  })) {
    const line = raw.replace(/^﻿/, '');
    if (line === '') continue;
    const fields = parseCsvLine(line);
    if (header === null) {
      header = fields.map((f) => f.trim());
      continue;
    }
    const row: CsvRow = {};
    header.forEach((name, i) => {
      row[name] = fields[i] ?? '';
    });
    yield row;
  }
}

/** Relative tolerance of `run_test.R`. @rfc RFC-77 R9 */
const TOLERANCE = 1e-9;

/**
 * Whether the owner's text value and a computed one agree: empty or `NA`
 * equals null or empty; `TRUE`/`FALSE` equal booleans; numbers agree within
 * a relative 1e-9; anything else must be equal text.
 * @rfc RFC-77 R9
 */
export function valuesMatch(expected: string | undefined, got: unknown): boolean {
  const e = (expected ?? '').trim();
  if (e === '' || e === 'NA') return got === null || got === undefined || got === '';
  if (typeof got === 'boolean') return e.toUpperCase() === String(got).toUpperCase();
  const en = Number(e);
  if (typeof got === 'number' && Number.isFinite(en)) {
    return Math.abs(en - got) <= TOLERANCE * Math.max(1, Math.abs(en));
  }
  return e === String(got ?? '');
}

/**
 * The platform's `outlier_flags` as the owner's summaries can state them:
 * without `bounds_inverted`, which the owner's package never emits (owner,
 * 2026-10-27; issue #347).
 * @rfc RFC-77 R9
 */
export function ownerOutlierFlags(flags: string): string {
  return flags
    .split(';')
    .filter((f) => f !== '' && f !== 'bounds_inverted')
    .join(';');
}

/** The outcome of one comparison. @rfc RFC-77 R9 */
export interface Comparison {
  compared: number;
  problems: string[];
}

/**
 * Compares the owner's rows with the computed ones, matched on `keys`;
 * `columns` maps an owner column to the computed field. A row on one side
 * only is a problem, and so is every column that disagrees.
 * @rfc RFC-77 R9
 */
export function compareRows<T extends object>(
  expected: Iterable<CsvRow>,
  computed: readonly T[],
  keys: { expected: string[]; computed: (keyof T)[] },
  columns: Record<string, keyof T>,
): Comparison {
  const keyOf = (parts: unknown[]) => parts.map((p) => String(p ?? '').trim()).join('\u0000');
  const byKey = new Map<string, T>();
  for (const row of computed) byKey.set(keyOf(keys.computed.map((k) => row[k])), row);
  const seen = new Set<string>();
  const problems: string[] = [];
  let compared = 0;
  for (const row of expected) {
    const key = keyOf(keys.expected.map((k) => row[k]));
    const label = keys.expected.map((k) => row[k]).join(' / ');
    seen.add(key);
    compared++;
    const got = byKey.get(key);
    if (!got) {
      problems.push(`missing: ${label}`);
      continue;
    }
    for (const [column, field] of Object.entries(columns)) {
      if (!valuesMatch(row[column], got[field])) {
        problems.push(`${label}: ${column} expected ${row[column]} got ${String(got[field])}`);
      }
    }
  }
  for (const [key, row] of byKey) {
    if (!seen.has(key)) problems.push(`extra: ${keys.computed.map((k) => row[k]).join(' / ')}`);
  }
  return { compared, problems };
}

import type { Sql, TransactionSql } from 'postgres';

/**
 * Every table an import fills, in one `TRUNCATE`. The list is the full
 * foreign-key closure: `reference_traits` and `species_proposals` are here not
 * because an import writes them but because they reference tables that are
 * being emptied, and PostgreSQL refuses a partial `TRUNCATE` across a foreign
 * key. `import_batches` is absent on purpose: the running batch's row is
 * created before the transaction so that RFC-64 R9 can mark it `failed`, and
 * truncating the table would delete it. Earlier batches go by DELETE instead.
 * Left alone: `users`, `roles`, `permissions`, the trait dictionary
 * (`traits`, `trait_levels`, `trait_categories`) and `audit_log`.
 * @rfc RFC-64 R12
 */
export const RESET_TABLES = [
  'accepted_values',
  'record_annotations',
  'reference_traits',
  'species_proposals',
  'trait_records',
  'species_trait_coverage',
  'import_rejects',
  'user_plots',
  'plot_species',
  'plots',
  'species_names',
  'species',
  'genera',
  'families',
  'bibliographic_references',
] as const;

/**
 * The RFC-63 R4 append-only triggers. They fire for the table owner too, so a
 * reset has to switch them off for the length of its transaction — which is
 * why this runs as the migrator role and never as `treerepro_app`, and why
 * `treerepro_app` keeps holding no `UPDATE`/`DELETE` on these tables.
 * @rfc RFC-63 R4
 */
const APPEND_ONLY_TRIGGERS: readonly [string, string][] = [
  ['trait_records', 'trait_records_append_only'],
  ['trait_records', 'trait_records_no_truncate'],
  ['record_annotations', 'record_annotations_append_only'],
  ['record_annotations', 'record_annotations_no_truncate'],
  ['accepted_values', 'accepted_values_append_only'],
  ['accepted_values', 'accepted_values_no_truncate'],
];

/**
 * Empties everything previous imports loaded, keeping accounts and the trait
 * dictionary. Must run inside the caller's transaction so that a failure later
 * in the import rolls the wipe back and leaves the old dataset in place
 * (RFC-64 R12); the triggers are restored in the same transaction, so a
 * rollback restores them regardless.
 * @rfc RFC-64 R12
 */
export async function resetDataset(tx: TransactionSql | Sql, keepBatchId: string): Promise<void> {
  for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
    await tx`alter table ${tx(table)} disable trigger ${tx(trigger)}`;
  }
  // One statement: PostgreSQL refuses to truncate a table while another table
  // still references it, so every member of the closure goes together.
  await tx`truncate table ${tx(RESET_TABLES as unknown as string[])}`;
  // Every earlier batch, but not this one: its row predates the transaction so
  // that a failure can still be recorded against it (RFC-64 R9).
  await tx`delete from import_batches where id <> ${keepBatchId}`;
  for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
    await tx`alter table ${tx(table)} enable trigger ${tx(trigger)}`;
  }
}

/**
 * A replacing import is refused in production: it deletes the dataset, and the
 * append-only guarantee of RFC-63 R4 is exactly what a real deployment relies
 * on. The production container also carries no migrator secret, so this check
 * is the first of two independent gates, not the only one.
 * @rfc RFC-64 R12
 */
export function isReplaceAllowed(nodeEnv: string): boolean {
  return nodeEnv !== 'production';
}

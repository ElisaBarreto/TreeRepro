# Dataset import

## `COPY` inside a Drizzle transaction throws
**Symptom:** Calling `tx.execute(sql\`copy … from stdin …\`)` inside a `db.transaction()` callback fails or never streams.
**Cause:** `COPY … FROM STDIN` needs the raw postgres.js connection object (its `.writable()` stream) held for the whole transfer; Drizzle's `db.transaction()` wraps queries one at a time and has no way to hand back that raw connection.
**Fix:** Reach for the underlying client with `db.$client` and open the transaction yourself with `sql.begin(async (tx) => { … })` (postgres.js), then call `` tx`copy … from stdin with (...)`.writable() `` on that `tx`. See `apps/api/src/dataset/import.ts` and `seed.ts`.

## Unquoted empty CSV fields become `NULL`, not `''`
**Symptom:** A lookup column built from a CSV field that is present but empty (e.g. `wcvp_species` for a row with no accepted name) is `NULL` where the code expected an empty string, breaking `coalesce` chains and `<>` comparisons.
**Cause:** With `format csv`, Postgres's `COPY` follows the CSV convention: an unquoted empty field is `NULL`, only `""` (an explicitly quoted empty string) is `''`. The compiled dataset never quotes empty fields.
**Fix:** Normalise with `nullif(trim(x), '')` before using a column in `coalesce()` or building JSON (`jsonb_build_object(..., coalesce(s.field, ''))` for the reject payload) — never assume `''` survived the trip through `COPY`.

## `CREATE TABLE` fails for the app role — but temporary tables don't
**Symptom:** `permission denied for schema public` when the importer tries to stage rows in a normal table under the `treerepro_app` role.
**Cause:** `infra/postgres/init/01-roles.sh` (RFC-10 R7, RFC-41 R9) grants `treerepro_app` default privileges of `SELECT, INSERT, UPDATE, DELETE` on the application tables but not `CREATE` in `public` (that's `treerepro_migrator`'s job). Session-local temporary tables are exempt — they live in `pg_temp`, which every role can create in.
**Fix:** Stage with `create temporary table import_staging (...) on commit drop`, inside the same `sql.begin` transaction as the `COPY` and the inserts that follow. `on commit drop` means no cleanup step is needed even on error.

## `ON CONFLICT DO NOTHING`'s row count *is* the duplicate counter
**Symptom:** The temptation to add `RETURNING id` to the `trait_records` insert "to know what happened" to each row.
**Cause:** postgres.js's tagged-template result exposes `.count`, the number of rows the statement actually affected — for `INSERT … ON CONFLICT DO NOTHING`, that is already exactly the number of rows inserted (conflicting rows are silently skipped and never counted). `duplicate = total - rejected - inserted` falls out of that count for free.
**Fix:** Never add `RETURNING` to the batch insert. Read `.count` off the query result directly; adding `RETURNING` forces Postgres to build and hand back a result set for 14,533+ rows for no reason, and tempts you to compute the duplicate count by counting returned rows instead (which conflicting rows never appear in).

## `NULLS NOT DISTINCT` is what makes the claim key work without a secondary reference
**Symptom:** Two import rows that share species, trait, value and primary reference — but both have no secondary reference — insert as two separate `trait_records` instead of one being caught as a duplicate on re-import.
**Cause:** Ordinary Postgres unique constraints treat every `NULL` as distinct from every other `NULL`, so `(species_id, trait_id, value_text, raw_value, primary_reference_id, secondary_reference_id)` with `secondary_reference_id IS NULL` never conflicts with itself.
**Fix:** `trait_records_claim_key` is declared `UNIQUE NULLS NOT DISTINCT (...)` (migration `0011_dataset_records.sql`), so two rows that are `NULL` in the same column are treated as equal for the constraint — exactly the rows the claim key needs to dedupe.

## `pg_trgm` GIN indexes need the extension created first, in an earlier migration
**Symptom:** `drizzle-kit generate` (or replaying migrations on a fresh database) fails with `operator class "gin_trgm_ops" does not exist for access method "gin"` on `CREATE INDEX ... USING gin (... gin_trgm_ops)`.
**Cause:** `gin_trgm_ops` is provided by the `pg_trgm` extension, which must exist in the database before any migration creates an index that uses it. Drizzle's generated migration only contains the `CREATE INDEX` statement, not the extension.
**Fix:** Keep `0009_pg_trgm.sql` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) as its own migration, numbered ahead of `0010_dataset_catalogs.sql`, which builds the trigram indexes on `bibliographic_references.citation_key`, `species.canonical_name` and `species_names.name` (RFC-10 R14). Migration order is filename order — don't fold the extension into the same file as the indexes it enables, or a future regeneration could reorder the statements.

## JS template strings need `'\\s+'` for Postgres to see `\s+`
**Symptom:** `regexp_replace(wcvp_species, '\s+', ' ', 'g')` written directly in a *cooked* JS template literal never reaches Postgres as `\s+`: a single `\s` is not a recognised JS escape, so the engine drops the backslash and Postgres receives the literal letter `s` — `regexp_replace(x, 's+', ' ', 'g')` would collapse runs of the letter `s`, not whitespace.
**Cause:** In a normal (non-raw) JS string/template literal, `\` followed by a character with no defined escape meaning is silently discarded, keeping only the character; the safe, unambiguous way to send a literal backslash to Postgres from a JS template string is to write it twice.
**Fix:** Write `'\\s+'` in the tagged-template SQL (`tx\`... regexp_replace(wcvp_species, '\\s+', ' ', 'g') ...\``) so the string that actually reaches Postgres contains `\s+`. `apps/api/src/dataset/import.ts` does this for every `regexp_replace` call that normalises whitespace in species, genus and family names.

## postgres.js 3.4.9 can hang forever on a bad `COPY` row
**Symptom:** The importer never returns and never throws when the CSV has a row that violates the `COPY` format (wrong column count, bad encoding) — no error, no timeout, no CPU activity; the process just sits there.
**Cause:** Verified directly against the driver, outside Drizzle: `.writable()` runs `COPY` over the simple query protocol. When the server rejects a row, it answers `ErrorResponse` + `ReadyForQuery`, but the client's writable only resolves from its `CommandComplete` handler — the same and only place that invokes the `final()` callback stored when `.end()` sends `CopyDone`. `CommandComplete` never arrives on the error path, so if `.end()` is called before the driver has processed the server's error, `connection.js`'s `final()` has already nulled `stream` and the writable neither errors nor finishes. The pipeline hangs silently on both ends.
**Fix:** Nothing pipes directly into the writable; every COPY (the importer, the dictionary seed) wraps the transfer in `pipelineWithIdleGuard` (`apps/api/src/db/copy.ts`), which aborts (`.destroy()`, sending `CopyFail`) once the destination has gone `idleTimeoutMs` (60 s by default, injectable for tests) without accepting a new chunk — not once the whole transfer has taken too long, since a real multi-million-row file can legitimately run for minutes. If the real Postgres error arrives first, it is kept and the abort path never fires. Upstream: postgres.js 3.4.9, `.writable()` COPY error path (the hang reproduces with the driver alone); until it is fixed there, a new COPY call site must go through the guard too — `seed.integration.test.ts` and `import.integration.test.ts` each pin the timeout with a malformed row.

## `ON DELETE RESTRICT` raises SQLSTATE `23001`, not `23503`
**Symptom:** Deleting a referenced catalog row (a species, a trait, a reference) that still has dependent `trait_records` throws, but `isForeignKeyViolation(err)` returns `false` for that error.
**Cause:** Postgres distinguishes the two sides of a foreign key violation: inserting/updating a row whose FK value doesn't exist in the referenced table is `23503` (`foreign_key_violation`); deleting/updating a *referenced* row that a `RESTRICT` (or `NO ACTION`) constraint still points at is `23001` (`restrict_violation`) — a different code in the same class. `apps/api/src/db/errors.ts`'s `isForeignKeyViolation` only checks `23503`.
**Fix:** Every dataset FK is declared `ON DELETE restrict`, so code that deletes catalog rows and wants to detect "still referenced" must check for `23001` explicitly (or extend `isForeignKeyViolation`, deliberately, if the two cases should ever be handled the same way) — don't assume `isForeignKeyViolation` covers it.

## `now()` inside a transaction is frozen at `BEGIN`
**Symptom:** `import_batches.finished_at` equals `started_at` (or predates it) even though the import ran for over a second.
**Cause:** Postgres's `now()` (and `current_timestamp`, `transaction_timestamp()`) returns the time the *transaction* started, not the current statement — the same value on every call for the whole `sql.begin` block, no matter how long the transaction runs.
**Fix:** Use `clock_timestamp()` for any timestamp that must reflect when a statement actually executed, not when the transaction began. The batch's final `UPDATE … SET finished_at = clock_timestamp()` in `importRecords` relies on this.

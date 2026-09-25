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

## `user_plots` stages the file untouched and hashes the distinct e-mails in Node
**Symptom:** Temptation to write a pre-processed or sanitized copy of the `user_plots` CSV to disk before loading.
**Cause:** GDPR applies strictly to user data. The `user_plots` import file contains raw emails (PII).
**Fix:** `user_plots` stages the file untouched and hashes the distinct e-mails in Node inside the transaction (`update … from (values …)`); never write a temporary copy of a file with PII.

## Replacing the imported data with the ID-carrying file (spec 2026-09-25 §5)

**Symptom:** After the record-schema migration (0035 at the time of writing; check `apps/api/drizzle/`) every existing record has a `record_code` of `EB_LEGACY_<n>`, and the owner has the new source file, `sample_data.csv`, whose header is quoted, starts with an unnamed column (`""`, R's row numbers) and ends in `"ID"`.

**Cause:** The `ID` column did not exist when the data was loaded; the migration only makes `record_code NOT NULL` possible. The owner decided to replace everything earlier imports loaded with the new file (RFC-64 R12). `--replace` is refused in production twice — by `isReplaceAllowed` and by the missing migrator secret in the `api` container — and this procedure is the one sanctioned exception (RFC-64 R12). It is safe only while nothing but imported data would be lost, so it stops unless manual records, annotations and `record_references` are all zero.

**Fix:** Run on the production host, from the checkout, with the new file at `/srv/imports/sample_data.csv` (its header is quoted; the first line ends `"harmonised_value","ID"`, after the unnamed `""` first column of R row numbers, which the importer reads and ignores) and the supplementary files beside it.

1. **Back up** (a `pg_dump` by the read-only `treerepro_backup` role, `age`-encrypted into the `backups` volume):
   ```sh
   docker compose run --rm --no-deps --entrypoint /usr/local/bin/backup.sh backup
   ```
   It prints `backup written: /backups/treerepro-<stamp>.sql.age`. Restoring it is "Restoring a backup" in `docs/gotchas/infra.md`.
2. **Stop the API**, then deploy and migrate (a running `api` would keep writing through the old trigger functions — see "Stop `api` before applying migration 0022" in `docs/gotchas/postgres.md`; the record-schema migration (0035 at the time of writing; check `apps/api/drizzle/`) rewrites all ~9.3M `trait_records` rows under an `ACCESS EXCLUSIVE` lock, then builds a unique index on `record_code` and validates four `CHECK` constraints — this takes minutes on the full dataset and the API stays down for all of it: let it finish):
   ```sh
   docker compose stop api
   git pull && docker compose build
   docker compose run --rm migrate
   ```
3. **Stop unless nothing but imported data exists:**
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -v ON_ERROR_STOP=1 -At -F ' ' -c \
     "select (select count(*) from trait_records where origin = 'manual'), (select count(*) from record_annotations), (select count(*) from record_references)"
   ```
   The answer must be `0 0 0`. Anything else: **do not continue** — bring the API back (`docker compose up -d api`) and take the numbers to the owner. Note, for step 6, what the replace will also empty:
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -F ' ' -c \
     "select (select count(*) from plots), (select count(*) from plot_species), (select count(*) from user_plots), (select count(*) from species_names where name_type <> 'gbif'), (select count(*) from species where not active)"
   ```
4. **Replace.** A one-off container of the `api` image, with the migrator secret mounted and `NODE_ENV` overridden for this run only (the CLI then connects as `treerepro_migrator`, which may disable the RFC-63 R4 append-only triggers inside the import's own transaction and restores them there):
   ```sh
   docker compose run --rm --no-deps \
     -e NODE_ENV=development \
     -v "$PWD/infra/secrets/db_migrator_password:/run/secrets/db_migrator_password:ro" \
     -v /srv/imports:/imports:ro \
     api node dist/cli/import-records.js --file /imports/sample_data.csv --replace --run-by <owner e-mail>
   ```
   The report must read `Mode: replace` and `completed`. Its `already imported: <n>` line (RFC-64 R14) must read `already imported: 0` on this total replace — `--replace` empties `trait_records` itself, inside this same transaction (`resetDataset`, `apps/api/src/dataset/reset.ts`, called from `importRecords` before the file is staged), not in step 2; anything else means that wipe did not run (check the report's `Mode:` line really reads `replace`, not `append`). `invalid_record_id` and `duplicate_record_id` in `Rejections:` are rows of the file with a missing or malformed `ID`, or one an earlier row already used; they are listed on the batch page (`/app/imports/<batch id>` in the workspace) and are not loaded. A failure rolls everything back and the previous data stays.
5. **Check the triggers are back on** (`O` = enabled):
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -c \
     "select tgname, tgenabled from pg_trigger where tgname in ('trait_records_append_only', 'trait_records_no_truncate', 'record_annotations_append_only', 'record_annotations_no_truncate') order by 1"
   ```
6. **Reload what the replace emptied** (README commands, same files as the first load, in this order). Plots, plot species, user plots, synonyms and references are generated from the owner's raw exports (`PIs_per_plot_filtered.csv`, `Species_per_plot_filtered.csv`, `refs_with_citations_filtered.csv`, …) the same way as any other load, through `prepare:imports` (README):
   ```sh
   pnpm --filter @treerepro/api prepare:imports --source <dir> --out <dir>
   ```
   which writes the `import:*` files, including the `user_email,plot_id` user-plots file — check `apps/api/src/cli/prepare-imports.ts` for the current output names before copying anything into `/srv/imports` (at the time of writing: `plots.import.csv`, `plot-species.import.csv`, `user-plots.import.csv`, `synonyms.import.csv`, `references.import.csv`). `species-status.csv` is not produced by `prepare:imports`; the owner maintains it directly. Copy all six files into `/srv/imports` next to `sample_data.csv`, then:
   ```sh
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-species-status.js --file /imports/species-status.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-plots.js --file /imports/plots.import.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-plot-species.js --file /imports/plot-species.import.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-user-plots.js --file /imports/user-plots.import.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-synonyms.js --file /imports/synonyms.import.csv
   docker compose run --rm --no-deps -v /srv/imports:/imports:ro api node dist/cli/import-references.js --file /imports/references.import.csv
   ```
   Re-run the second query of step 3 and compare. Taxonomy proposals (`species_proposals`) are rebuilt by their own job.
7. **Verify:**
   ```sh
   docker compose exec -T postgres psql -U postgres -d treerepro -At -F ' ' -c \
     "select (select count(*) from import_batches where kind = 'records'), (select count(*) from trait_records), (select count(*) from trait_records where record_code like 'EB_LEGACY_%'), (select count(*) from trait_records where record_code !~ '^EB_[0-9]+([a-z]+)?\$'), (select coalesce(sum(primary_count), 0) from bibliographic_references) = (select count(*) from trait_records where primary_reference_id is not null)"
   ```
   Expected: `1 <N> 0 0 t`, where `<N>` equals `inserted` in step 4's `Rows:` line.
8. **Start the API:** `docker compose up -d api`, then `docker compose ps` shows it healthy.

After this test phase, reimports use `--replace-imported` (plan 13k) instead of a total `--replace`: once any `TR_` record exists (a manual record created after this reimport), the total `--replace` is refused (RFC-64 R12).


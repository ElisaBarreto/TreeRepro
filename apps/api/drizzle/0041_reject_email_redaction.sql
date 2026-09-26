-- RFC-68 R11 (amended 2026-09-26): rejects written before the amendment kept
-- the first letter and domain of the e-mail, and a failed batch's error could
-- quote the row; reduce both to what new runs store.
UPDATE import_rejects SET raw_row = jsonb_set(raw_row, '{user_email}', '"***"')
WHERE coalesce(raw_row->>'user_email', '') NOT IN ('', '***');
--> statement-breakpoint
UPDATE import_batches
SET error = regexp_replace(error, '(COPY import_staging, line [0-9]+[^:"]*): ".*$', '\1')
WHERE kind = 'user_plots' AND error ~ 'COPY import_staging, line [0-9]+[^:"]*: "';

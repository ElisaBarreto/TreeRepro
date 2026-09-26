-- RFC-68 R11 (amended 2026-09-26): rejects written before the amendment kept
-- the first letter and domain of the e-mail; reduce them to `***` like new ones.
UPDATE import_rejects SET raw_row = jsonb_set(raw_row, '{user_email}', '"***"')
WHERE coalesce(raw_row->>'user_email', '') NOT IN ('', '***');

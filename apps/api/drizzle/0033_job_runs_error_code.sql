-- RFC-74 R1 (issue #114): job_runs.error holds a failure code — identifiers
-- such as `Error 23505` or `Error ETIMEDOUT 421` — never an exception message,
-- because the health page of RFC-52 publishes the column to an administrator's
-- browser. Rows written before this migration hold `<code>: <first line of the
-- driver message>` (the former safeErrorSummary); the head before the first
-- ': ' is exactly the code the new writer would have stored, and a head that
-- still does not fit the pattern is dropped rather than kept as text.
UPDATE job_runs
SET error = CASE
  WHEN split_part(error, ': ', 1) ~ '^[A-Za-z0-9_]{1,64}( [A-Za-z0-9_]{1,64}){0,2}$' THEN split_part(error, ': ', 1)
  ELSE NULL
END
WHERE error IS NOT NULL AND error !~ '^[A-Za-z0-9_]{1,64}( [A-Za-z0-9_]{1,64}){0,2}$';
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_error_check" CHECK ("job_runs"."error" is null or "job_runs"."error" ~ '^[A-Za-z0-9_]{1,64}( [A-Za-z0-9_]{1,64}){0,2}$');

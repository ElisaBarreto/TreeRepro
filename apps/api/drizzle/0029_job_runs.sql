CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "job_runs_kind_check" CHECK ("job_runs"."kind" in ('audit_purge', 'digest')),
	CONSTRAINT "job_runs_status_check" CHECK ("job_runs"."status" in ('running', 'completed', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX "job_runs_kind_idx" ON "job_runs" USING btree ("kind","started_at" DESC NULLS LAST);
--> statement-breakpoint
-- RFC-74 R7: job_runs is append-only by GRANT, not by trigger. The runtime
-- role opens its own rows (startRun INSERTs) and closes them (finishRun
-- UPDATEs the row it opened), and can never remove one; rows older than a year
-- go through job_runs_purge() below. Stated explicitly rather than left to the
-- migrator's default privileges (infra/postgres/init/01-roles.sh, which also
-- grants DELETE), the 0022 pattern. Guarded like 0007 / 0022 / 0023: the role
-- exists in every real database but not in a bare drizzle-kit check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE DELETE, TRUNCATE ON job_runs FROM treerepro_app;
    GRANT SELECT, INSERT, UPDATE ON job_runs TO treerepro_app;
  END IF;
END;
$$;
--> statement-breakpoint
-- RFC-42 R6: audit_log_purge()'s companion, owned by the migrator. It is
-- SECURITY DEFINER purely because the app role holds no DELETE on job_runs;
-- unlike R2 there is no append-only trigger here, so there is no bypass flag
-- to set. pg_temp is named explicitly and LAST: unless it appears in
-- search_path PostgreSQL searches the temporary schema FIRST for relation
-- names, so a caller holding TEMPORARY (treerepro_app does, via the default
-- PUBLIC grant) could create pg_temp.job_runs and have this definer body act
-- on it as the migrator (the 0023 pattern). The retention period is
-- hard-coded and the function takes no parameter, so no caller can purge
-- younger runs.
CREATE FUNCTION job_runs_purge() RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  purged bigint;
BEGIN
  DELETE FROM job_runs WHERE started_at < now() - interval '1 year';
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION job_runs_purge() FROM PUBLIC;
--> statement-breakpoint
-- Guarded like the grants above (0023 does the same for audit_log_purge()).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    GRANT EXECUTE ON FUNCTION job_runs_purge() TO treerepro_app;
  END IF;
END;
$$;

-- RFC-42 R2: audit_log_purge() keeps its body, owner and privileges; only the
-- pinned search_path changes. 0007 wrote `SET search_path = public`, which
-- leaves the temporary schema searched FIRST: unless pg_temp is named,
-- PostgreSQL looks there before every listed schema for relation names, so a
-- caller holding TEMPORARY (treerepro_app does, via the default PUBLIC grant)
-- could create pg_temp.audit_log and have this SECURITY DEFINER body delete
-- from it as the migrator. Naming pg_temp explicitly and LAST puts it after
-- public, where it can shadow nothing (the 0022 pattern).
CREATE OR REPLACE FUNCTION audit_log_purge() RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  purged bigint;
BEGIN
  PERFORM set_config('treerepro.allow_audit_purge', 'on', true);
  DELETE FROM audit_log WHERE at < now() - interval '2 years';
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;
--> statement-breakpoint
-- OR REPLACE keeps the owner and the ACL; restated so the privileges of
-- RFC-42 R3 / RFC-41 R9 hold even if the function is ever recreated from here.
REVOKE ALL ON FUNCTION audit_log_purge() FROM PUBLIC;
--> statement-breakpoint
-- Guarded like 0007: the role exists in every real database (01-roles.sh) but not in a bare drizzle-kit check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    GRANT EXECUTE ON FUNCTION audit_log_purge() TO treerepro_app;
    REVOKE DELETE ON audit_log FROM treerepro_app;
  END IF;
END;
$$;

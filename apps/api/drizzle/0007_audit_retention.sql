-- RFC-42 R2: the only path that deletes audit entries. Runs as its owner
-- (treerepro_migrator, who owns the table) so the app role needs no DELETE.
-- search_path is pinned: a SECURITY DEFINER function must not resolve names
-- through the caller's path.
CREATE FUNCTION audit_log_purge() RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
REVOKE ALL ON FUNCTION audit_log_purge() FROM PUBLIC;
--> statement-breakpoint
-- RFC-42 R3, RFC-41 R9: the app role executes the function and loses DELETE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    GRANT EXECUTE ON FUNCTION audit_log_purge() TO treerepro_app;
    REVOKE DELETE ON audit_log FROM treerepro_app;
  END IF;
END;
$$;

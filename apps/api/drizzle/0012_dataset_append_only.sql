-- RFC-63 R4: records, annotations and accepted values are append-only. The
-- trigger stops the owner too; the revoke stops the app role even if a trigger
-- is ever disabled (the audit_log technique, 0001 and 0007).
CREATE FUNCTION dataset_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trait_records_append_only BEFORE UPDATE OR DELETE ON trait_records
FOR EACH ROW EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER trait_records_no_truncate BEFORE TRUNCATE ON trait_records
FOR EACH STATEMENT EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER record_annotations_append_only BEFORE UPDATE OR DELETE ON record_annotations
FOR EACH ROW EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER record_annotations_no_truncate BEFORE TRUNCATE ON record_annotations
FOR EACH STATEMENT EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER accepted_values_append_only BEFORE UPDATE OR DELETE ON accepted_values
FOR EACH ROW EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER accepted_values_no_truncate BEFORE TRUNCATE ON accepted_values
FOR EACH STATEMENT EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
-- RFC-63 R7: an accepted record belongs to the row's species and trait.
CREATE FUNCTION accepted_values_match_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record_id IS NOT NULL THEN
    PERFORM 1 FROM trait_records r
    WHERE r.id = NEW.record_id AND r.species_id = NEW.species_id AND r.trait_id = NEW.trait_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'accepted record does not belong to this species and trait'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accepted_values_match BEFORE INSERT ON accepted_values
FOR EACH ROW EXECUTE FUNCTION accepted_values_match_record();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE UPDATE, DELETE ON trait_records, record_annotations, accepted_values FROM treerepro_app;
  END IF;
END;
$$;

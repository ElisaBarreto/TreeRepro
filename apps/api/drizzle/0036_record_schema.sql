CREATE SEQUENCE "public"."record_code_tr_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "record_references" (
	"record_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	CONSTRAINT "record_references_record_id_reference_id_pk" PRIMARY KEY("record_id","reference_id")
);
--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_harmonised_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_one_value_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_value_requires_harmonised_check";--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "rows_already_imported" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Spec R-2 / §5: existing rows get a throw-away code the replacing import of
-- the reimport runbook swaps out (docs/gotchas/import.md). A volatile default
-- on ADD COLUMN rewrites the table inside the ALTER, so no UPDATE runs and the
-- RFC-63 R4 append-only triggers never fire; the platform's own sequence
-- starts untouched at TR_1.
CREATE SEQUENCE "record_code_legacy_seq";--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "record_code" text DEFAULT ('EB_LEGACY_' || nextval('record_code_legacy_seq')) NOT NULL;--> statement-breakpoint
ALTER TABLE "trait_records" ALTER COLUMN "record_code" SET DEFAULT ('TR_' || nextval('record_code_tr_seq'));--> statement-breakpoint
DROP SEQUENCE "record_code_legacy_seq";--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "min_value" numeric;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "max_value" numeric;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "mean_value" numeric;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "sd_value" numeric;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "n" integer;--> statement-breakpoint
ALTER TABLE "record_references" ADD CONSTRAINT "record_references_record_id_trait_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."trait_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_references" ADD CONSTRAINT "record_references_reference_id_bibliographic_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."bibliographic_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_references_reference_idx" ON "record_references" USING btree ("reference_id");--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_record_code_key" UNIQUE("record_code");--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_quantitative_check" CHECK (("trait_records"."min_value" is null or "trait_records"."max_value" is null or "trait_records"."min_value" <= "trait_records"."max_value")
        and ("trait_records"."sd_value" is null or "trait_records"."sd_value" >= 0) and ("trait_records"."n" is null or "trait_records"."n" >= 1));--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_harmonised_check" CHECK ("trait_records"."harmonisation" <> 'harmonised' or "trait_records"."level_id" is not null
        or coalesce("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value") is not null);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_one_value_check" CHECK ("trait_records"."level_id" is null or num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."sd_value", "trait_records"."n") = 0);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_value_requires_harmonised_check" CHECK (("trait_records"."level_id" is null and num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."sd_value", "trait_records"."n") = 0)
        or "trait_records"."harmonisation" = 'harmonised');
--> statement-breakpoint
-- RFC-63 R12 (spec R-2): the letters of the parts of a split entry, in
-- bijective base 26 — 1 → a, 26 → z, 27 → aa, 28 → ab. The import suffixes
-- `EB_1a`, `EB_1b`; nextRecordCodes() suffixes `TR_7a`, `TR_7b`.
CREATE FUNCTION record_code_suffix(n bigint) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH RECURSIVE d(q, s) AS (
    SELECT n, ''::text
    UNION ALL
    SELECT (q - 1) / 26, chr(97 + ((q - 1) % 26)::int) || s FROM d WHERE q > 0
  )
  SELECT s FROM d WHERE q = 0
$$;
--> statement-breakpoint
-- RFC-61 R4, R9 (spec R-4): a record_references row is a use of its reference
-- in the primary role and in reference_traits. A trigger of its own, not an
-- edit of trait_records_reference_usage(), so the functions never collide.
-- SECURITY DEFINER with pg_temp named last, the 0022/0027 pattern:
-- reference_traits is read-only for the app role.
CREATE FUNCTION record_references_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE bibliographic_references r SET primary_count = r.primary_count + u.n
  FROM (SELECT reference_id AS id, count(*) AS n FROM inserted GROUP BY 1) u
  WHERE r.id = u.id;
  INSERT INTO reference_traits (reference_id, trait_id, record_count)
  SELECT i.reference_id, t.trait_id, count(*)
  FROM inserted i JOIN trait_records t ON t.id = i.record_id
  GROUP BY 1, 2
  ON CONFLICT (reference_id, trait_id) DO UPDATE SET record_count = reference_traits.record_count + EXCLUDED.record_count;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_references_usage() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER record_references_usage AFTER INSERT ON record_references
REFERENCING NEW TABLE AS inserted
FOR EACH STATEMENT EXECUTE FUNCTION record_references_usage();
--> statement-breakpoint
-- RFC-63 R4 technique: the app role inserts but never rewrites.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON record_references FROM treerepro_app;
  END IF;
END;
$$;

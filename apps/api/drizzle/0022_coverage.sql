CREATE TABLE "species_trait_coverage" (
	"species_id" uuid NOT NULL,
	"trait_id" uuid NOT NULL,
	"record_count" integer NOT NULL,
	"harmonised_count" integer NOT NULL,
	"first_record_at" timestamp with time zone NOT NULL,
	"last_record_at" timestamp with time zone NOT NULL,
	CONSTRAINT "species_trait_coverage_species_id_trait_id_pk" PRIMARY KEY("species_id","trait_id")
);
--> statement-breakpoint
ALTER TABLE "species" ADD COLUMN "trait_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "species_trait_coverage" ADD CONSTRAINT "species_trait_coverage_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species_trait_coverage" ADD CONSTRAINT "species_trait_coverage_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "species_trait_coverage_trait_idx" ON "species_trait_coverage" USING btree ("trait_id","species_id");--> statement-breakpoint
CREATE INDEX "species_trait_count_idx" ON "species" USING btree ("trait_count","canonical_name","id");
--> statement-breakpoint
-- RFC-69 R2: the statement trigger of 0015 now also maintains coverage. The
-- function keeps its name (renaming would need DROP TRIGGER / CREATE TRIGGER)
-- and becomes SECURITY DEFINER with a fixed search_path (the audit_log_purge
-- pattern of 0007): it is owned by the migrator, which owns every table, so
-- the app role's inserts into trait_records maintain a table the app role can
-- only read. Records are append-only (RFC-63 R4), so nothing decrements.
CREATE OR REPLACE FUNCTION trait_records_reference_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE bibliographic_references r SET primary_count = r.primary_count + u.n
  FROM (SELECT primary_reference_id AS id, count(*) AS n FROM inserted WHERE primary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE r.id = u.id;
  UPDATE bibliographic_references r SET secondary_count = r.secondary_count + u.n
  FROM (SELECT secondary_reference_id AS id, count(*) AS n FROM inserted WHERE secondary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE r.id = u.id;
  WITH agg AS (
    SELECT species_id, trait_id, count(*) AS n, count(*) FILTER (WHERE harmonisation = 'harmonised') AS h,
           min(created_at) AS first_at, max(created_at) AS last_at
    FROM inserted GROUP BY 1, 2
  ), upserted AS (
    INSERT INTO species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
    SELECT species_id, trait_id, n, h, first_at, last_at FROM agg
    ON CONFLICT (species_id, trait_id) DO UPDATE SET
      record_count = species_trait_coverage.record_count + EXCLUDED.record_count,
      harmonised_count = species_trait_coverage.harmonised_count + EXCLUDED.harmonised_count,
      last_record_at = greatest(species_trait_coverage.last_record_at, EXCLUDED.last_record_at)
    -- xmax = 0 tells an inserted row from an updated one in an upsert.
    RETURNING species_id, (xmax = 0) AS inserted_new
  )
  UPDATE species s SET trait_count = s.trait_count + c.n
  FROM (SELECT species_id, count(*) AS n FROM upserted WHERE inserted_new GROUP BY 1) c
  WHERE s.id = c.species_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION trait_records_reference_usage() FROM PUBLIC;
--> statement-breakpoint
-- Guarded like 0007 / 0012: the role exists in every real database (01-roles.sh) but not in a bare drizzle-kit check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON species_trait_coverage FROM treerepro_app;
    GRANT SELECT ON species_trait_coverage TO treerepro_app;
  END IF;
END;
$$;
--> statement-breakpoint
-- RFC-69 R3 backfill (minutes on the full dataset; the migrator's statement timeout is unlimited).
INSERT INTO species_trait_coverage (species_id, trait_id, record_count, harmonised_count, first_record_at, last_record_at)
SELECT species_id, trait_id, count(*), count(*) FILTER (WHERE harmonisation = 'harmonised'), min(created_at), max(created_at)
FROM trait_records GROUP BY 1, 2
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE species s SET trait_count = c.n
FROM (SELECT species_id, count(*) AS n FROM species_trait_coverage GROUP BY 1) c
WHERE s.id = c.species_id;

CREATE TABLE "reference_traits" (
	"reference_id" uuid NOT NULL,
	"trait_id" uuid NOT NULL,
	"record_count" integer NOT NULL,
	CONSTRAINT "reference_traits_reference_id_trait_id_pk" PRIMARY KEY("reference_id","trait_id")
);
--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD COLUMN "short_citation" text;--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD COLUMN "full_citation" text;--> statement-breakpoint
ALTER TABLE "reference_traits" ADD CONSTRAINT "reference_traits_reference_id_bibliographic_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."bibliographic_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_traits" ADD CONSTRAINT "reference_traits_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reference_traits_trait_idx" ON "reference_traits" USING btree ("trait_id");

--> statement-breakpoint
-- RFC-61 R9: the statement trigger of 0015 (coverage since 0022) now also
-- maintains `reference_traits`. The function keeps its name (renaming would
-- need DROP TRIGGER / CREATE TRIGGER) and its header is reproduced verbatim
-- from 0022_coverage.sql, `SET search_path = public, pg_temp` included:
-- pg_temp is named explicitly, and LAST, because unless it appears in
-- search_path PostgreSQL searches it FIRST for relations, so a caller holding
-- TEMPORARY (treerepro_app does, via the default PUBLIC grant) could create
-- pg_temp.reference_traits and have this SECURITY DEFINER body resolve to it,
-- running attached triggers or rules as the migrator. Naming it last puts it
-- after public, where it can shadow nothing (RFC-69 R3).
-- CREATE OR REPLACE keeps the function's ACL, so the `REVOKE ALL ON FUNCTION
-- ... FROM PUBLIC` of 0022 still stands.
CREATE OR REPLACE FUNCTION trait_records_reference_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  -- RFC-61 R9: one row per reference x trait. The UNION is over DISTINCT
  -- (id, reference, trait) triples, not over counts: a record naming the same
  -- reference in both roles yields the same triple on both sides of the UNION,
  -- which collapses it to one, so the record counts once. (UNION ALL would
  -- count it twice.)
  INSERT INTO reference_traits (reference_id, trait_id, record_count)
  SELECT reference_id, trait_id, count(*) FROM (
    SELECT DISTINCT id, primary_reference_id AS reference_id, trait_id FROM inserted WHERE primary_reference_id IS NOT NULL
    UNION
    SELECT DISTINCT id, secondary_reference_id, trait_id FROM inserted WHERE secondary_reference_id IS NOT NULL
  ) x GROUP BY 1, 2
  ON CONFLICT (reference_id, trait_id) DO UPDATE SET record_count = reference_traits.record_count + EXCLUDED.record_count;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Guarded like 0007 / 0012 / 0022: the role exists in every real database
-- (01-roles.sh) but not in a bare drizzle-kit check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON reference_traits FROM treerepro_app;
    GRANT SELECT ON reference_traits TO treerepro_app;
  END IF;
END;
$$;
--> statement-breakpoint
-- RFC-61 R9 backfill (the migrator's statement timeout is unlimited). The same
-- UNION over DISTINCT triples as the trigger, so a record naming one reference
-- in both roles counts once here too.
INSERT INTO reference_traits (reference_id, trait_id, record_count)
SELECT reference_id, trait_id, count(*) FROM (
  SELECT DISTINCT id, primary_reference_id AS reference_id, trait_id FROM trait_records WHERE primary_reference_id IS NOT NULL
  UNION
  SELECT DISTINCT id, secondary_reference_id, trait_id FROM trait_records WHERE secondary_reference_id IS NOT NULL
) x GROUP BY 1, 2
ON CONFLICT DO NOTHING;

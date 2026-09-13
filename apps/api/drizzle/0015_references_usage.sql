ALTER TABLE "bibliographic_references" ADD COLUMN "primary_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD COLUMN "secondary_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD COLUMN "usage_count" integer GENERATED ALWAYS AS (primary_count + secondary_count) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "bibliographic_references_usage_idx" ON "bibliographic_references" USING btree ("usage_count" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- RFC-61 R4: usage counters are maintained on the reference row instead of
-- aggregated over trait_records on every list request (issue #47). One
-- statement-level trigger covers every insert path (the importer's
-- INSERT ... SELECT, the manual writer, test helpers); trait_records is
-- append-only (0012), so there is no decrement path to keep in step.
CREATE FUNCTION trait_records_reference_usage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE bibliographic_references r
  SET primary_count = r.primary_count + u.n
  FROM (SELECT primary_reference_id AS id, count(*) AS n FROM inserted
        WHERE primary_reference_id IS NOT NULL GROUP BY primary_reference_id) u
  WHERE r.id = u.id;
  UPDATE bibliographic_references r
  SET secondary_count = r.secondary_count + u.n
  FROM (SELECT secondary_reference_id AS id, count(*) AS n FROM inserted
        WHERE secondary_reference_id IS NOT NULL GROUP BY secondary_reference_id) u
  WHERE r.id = u.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trait_records_reference_usage AFTER INSERT ON trait_records
REFERENCING NEW TABLE AS inserted
FOR EACH STATEMENT EXECUTE FUNCTION trait_records_reference_usage();
--> statement-breakpoint
-- Backfill from the records that already exist.
UPDATE bibliographic_references r SET primary_count = p.n
FROM (SELECT primary_reference_id AS id, count(*) AS n FROM trait_records
      WHERE primary_reference_id IS NOT NULL GROUP BY primary_reference_id) p
WHERE r.id = p.id;
--> statement-breakpoint
UPDATE bibliographic_references r SET secondary_count = s.n
FROM (SELECT secondary_reference_id AS id, count(*) AS n FROM trait_records
      WHERE secondary_reference_id IS NOT NULL GROUP BY secondary_reference_id) s
WHERE r.id = s.id;

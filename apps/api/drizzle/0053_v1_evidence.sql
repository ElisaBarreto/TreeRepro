ALTER TABLE "trait_records" ADD COLUMN "counts_as_evidence" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "evidence_code" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "also_reported_by" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "dispersal_phase" text;--> statement-breakpoint
CREATE INDEX "trait_records_copies_idx" ON "trait_records" USING btree ("id") WHERE not "trait_records"."counts_as_evidence";--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_dispersal_phase_check" CHECK ("trait_records"."dispersal_phase" is null or "trait_records"."dispersal_phase" in ('primary', 'secondary', 'unspecified'));--> statement-breakpoint
-- RFC-63 R17, RFC-69 R2: a copy of evidence (counts_as_evidence false) is
-- never counted. The insert trigger of 0027 and the withdrawal's uncount of
-- 0038, each restricted to the records that count; bodies otherwise verbatim.
-- CREATE OR REPLACE keeps each function's owner, SECURITY DEFINER and grants.
CREATE OR REPLACE FUNCTION trait_records_reference_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE bibliographic_references r SET primary_count = r.primary_count + u.n
  FROM (SELECT primary_reference_id AS id, count(*) AS n FROM inserted WHERE counts_as_evidence AND primary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE r.id = u.id;
  UPDATE bibliographic_references r SET secondary_count = r.secondary_count + u.n
  FROM (SELECT secondary_reference_id AS id, count(*) AS n FROM inserted WHERE counts_as_evidence AND secondary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE r.id = u.id;
  WITH agg AS (
    SELECT species_id, trait_id, count(*) AS n, count(*) FILTER (WHERE harmonisation = 'harmonised') AS h,
           min(created_at) AS first_at, max(created_at) AS last_at
    FROM inserted WHERE counts_as_evidence GROUP BY 1, 2
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
    SELECT DISTINCT id, primary_reference_id AS reference_id, trait_id FROM inserted WHERE counts_as_evidence AND primary_reference_id IS NOT NULL
    UNION
    SELECT DISTINCT id, secondary_reference_id, trait_id FROM inserted WHERE counts_as_evidence AND secondary_reference_id IS NOT NULL
  ) x GROUP BY 1, 2
  ON CONFLICT (reference_id, trait_id) DO UPDATE SET record_count = reference_traits.record_count + EXCLUDED.record_count;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trait_records_uncount(ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- RFC-63 R17: a copy was never counted, so it is never uncounted.
  ids := ARRAY(SELECT id FROM trait_records WHERE id = ANY(ids) AND counts_as_evidence);
  IF cardinality(ids) = 0 THEN RETURN; END IF;
  UPDATE bibliographic_references b SET primary_count = b.primary_count - u.n
  FROM (SELECT primary_reference_id AS id, count(*) AS n FROM trait_records
        WHERE id = ANY(ids) AND primary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE b.id = u.id;
  UPDATE bibliographic_references b SET secondary_count = b.secondary_count - u.n
  FROM (SELECT secondary_reference_id AS id, count(*) AS n FROM trait_records
        WHERE id = ANY(ids) AND secondary_reference_id IS NOT NULL GROUP BY 1) u
  WHERE b.id = u.id;
  UPDATE bibliographic_references b SET primary_count = b.primary_count - u.n
  FROM (SELECT reference_id AS id, count(*) AS n FROM record_references
        WHERE record_id = ANY(ids) GROUP BY 1) u
  WHERE b.id = u.id;
  UPDATE species_trait_coverage c
  SET record_count = c.record_count - g.n, harmonised_count = c.harmonised_count - g.h
  FROM (SELECT species_id, trait_id, count(*) AS n,
               count(*) FILTER (WHERE harmonisation = 'harmonised') AS h
        FROM trait_records WHERE id = ANY(ids) GROUP BY 1, 2) g
  WHERE c.species_id = g.species_id AND c.trait_id = g.trait_id;
  -- A statement of its own: the UPDATE above must be visible before a cell it
  -- emptied is deleted and its species loses the trait.
  WITH emptied AS (
    DELETE FROM species_trait_coverage c
    USING (SELECT DISTINCT species_id, trait_id FROM trait_records WHERE id = ANY(ids)) g
    WHERE c.species_id = g.species_id AND c.trait_id = g.trait_id AND c.record_count = 0
    RETURNING c.species_id
  )
  UPDATE species s SET trait_count = s.trait_count - e.n
  FROM (SELECT species_id, count(*) AS n FROM emptied GROUP BY 1) e
  WHERE s.id = e.species_id;
  UPDATE reference_traits rt SET record_count = rt.record_count - u.n
  FROM (SELECT reference_id, trait_id, count(*) AS n FROM (
          SELECT DISTINCT id, primary_reference_id AS reference_id, trait_id FROM trait_records
          WHERE id = ANY(ids) AND primary_reference_id IS NOT NULL
          UNION
          SELECT DISTINCT id, secondary_reference_id, trait_id FROM trait_records
          WHERE id = ANY(ids) AND secondary_reference_id IS NOT NULL
        ) x GROUP BY 1, 2) u
  WHERE rt.reference_id = u.reference_id AND rt.trait_id = u.trait_id;
  UPDATE reference_traits rt SET record_count = rt.record_count - u.n
  FROM (SELECT rr.reference_id, r.trait_id, count(*) AS n
        FROM record_references rr JOIN trait_records r ON r.id = rr.record_id
        WHERE rr.record_id = ANY(ids) GROUP BY 1, 2) u
  WHERE rt.reference_id = u.reference_id AND rt.trait_id = u.trait_id;
  DELETE FROM reference_traits rt
  USING (SELECT DISTINCT trait_id FROM trait_records WHERE id = ANY(ids)) g
  WHERE rt.trait_id = g.trait_id AND rt.record_count = 0;
END;
$$;

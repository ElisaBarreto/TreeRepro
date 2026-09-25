CREATE TABLE "contest_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"contest_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_events_contest_kind_key" UNIQUE("contest_id","kind"),
	CONSTRAINT "contest_events_kind_check" CHECK ("contest_events"."kind" in ('resolve', 'withdraw'))
);
--> statement-breakpoint
CREATE TABLE "contest_levels" (
	"contest_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	CONSTRAINT "contest_levels_contest_id_level_id_pk" PRIMARY KEY("contest_id","level_id")
);
--> statement-breakpoint
CREATE TABLE "contest_records" (
	"contest_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	CONSTRAINT "contest_records_contest_id_record_id_pk" PRIMARY KEY("contest_id","record_id"),
	CONSTRAINT "contest_records_record_key" UNIQUE("record_id")
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"species_id" uuid NOT NULL,
	"trait_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_annotations" DROP CONSTRAINT "record_annotations_note_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_intent_check";--> statement-breakpoint
ALTER TABLE "contest_events" ADD CONSTRAINT "contest_events_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_events" ADD CONSTRAINT "contest_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_levels" ADD CONSTRAINT "contest_levels_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_levels" ADD CONSTRAINT "contest_levels_level_id_trait_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."trait_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_records" ADD CONSTRAINT "contest_records_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_records" ADD CONSTRAINT "contest_records_record_id_trait_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."trait_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contest_levels_level_idx" ON "contest_levels" USING btree ("level_id");--> statement-breakpoint
CREATE INDEX "contests_species_trait_idx" ON "contests" USING btree ("species_id","trait_id");--> statement-breakpoint
CREATE INDEX "contests_created_by_idx" ON "contests" USING btree ("created_by","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "record_annotations_withdraw_idx" ON "record_annotations" USING btree ("record_id") WHERE "record_annotations"."kind" = 'withdraw';--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_intent_check" CHECK (("trait_records"."responds_to_record_id" is null or "trait_records"."intent" is not null)
        and ("trait_records"."intent" is distinct from 'complement' or "trait_records"."responds_to_record_id" is not null));
--> statement-breakpoint
-- RFC-63 R14 (owner ruling 2026-09-25): a categorical contest states the
-- correct levels and responds to no record. No categorical contest record may
-- exist when this runs (13f's reimport runbook requires zero manual records):
-- one would carry the old meaning, so the migration stops instead of
-- converting it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trait_records r JOIN traits t ON t.id = r.trait_id
    WHERE r.intent = 'contest' AND t.value_type = 'categorical'
  ) THEN
    RAISE EXCEPTION 'contest_withdrawal: a categorical contest record exists; this migration does not convert it (RFC-63 R14)';
  END IF;
END;
$$;
--> statement-breakpoint
-- RFC-63 R4: the four contest tables are append-only like trait_records and
-- record_annotations (0012's function and trigger pair). The trigger stops the
-- owner too; the revoke below stops the app role even if a trigger is ever
-- disabled. RFC-64 R12's reset disables them by name (dataset/reset.ts).
CREATE TRIGGER contests_append_only BEFORE UPDATE OR DELETE ON contests
FOR EACH ROW EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER contests_no_truncate BEFORE TRUNCATE ON contests
FOR EACH STATEMENT EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER contest_levels_append_only BEFORE UPDATE OR DELETE ON contest_levels
FOR EACH ROW EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER contest_levels_no_truncate BEFORE TRUNCATE ON contest_levels
FOR EACH STATEMENT EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER contest_records_append_only BEFORE UPDATE OR DELETE ON contest_records
FOR EACH ROW EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER contest_records_no_truncate BEFORE TRUNCATE ON contest_records
FOR EACH STATEMENT EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER contest_events_append_only BEFORE UPDATE OR DELETE ON contest_events
FOR EACH ROW EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
CREATE TRIGGER contest_events_no_truncate BEFORE TRUNCATE ON contest_events
FOR EACH STATEMENT EXECUTE FUNCTION dataset_append_only();
--> statement-breakpoint
-- RFC-63 R4 technique (0036 for record_references): the app role inserts but
-- never rewrites.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON contests, contest_levels, contest_records, contest_events FROM treerepro_app;
  END IF;
END;
$$;
--> statement-breakpoint
-- RFC-63 R14 backfill: every existing quantitative contest record becomes a
-- contest of its own (its author and time) that created it. Row by row: there
-- are few of them, and each needs its contest's id.
DO $$
DECLARE
  r record;
  cid uuid;
BEGIN
  FOR r IN
    SELECT tr.id, tr.species_id, tr.trait_id, tr.created_by, tr.created_at
    FROM trait_records tr JOIN traits t ON t.id = tr.trait_id
    WHERE tr.intent = 'contest' AND t.value_type = 'quantitative'
    ORDER BY tr.id
  LOOP
    INSERT INTO contests (species_id, trait_id, created_by, created_at)
    VALUES (r.species_id, r.trait_id, r.created_by, r.created_at)
    RETURNING id INTO cid;
    INSERT INTO contest_records (contest_id, record_id) VALUES (cid, r.id);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- RFC-30 R3: the catalog row of RFC-65 R4. Admin only: the admin system role
-- holds every permission by name (RFC-31 R2), so no role_permissions row.
INSERT INTO permissions (key, description) VALUES
  ('records.withdraw_imported', 'Withdraw any imported record')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
UPDATE permissions SET description = 'Validate and contest records' WHERE key = 'records.annotate';
--> statement-breakpoint
UPDATE permissions SET description = 'Work the harmonisation and contested queues; resolve contests and withdraw levels' WHERE key = 'records.review';
--> statement-breakpoint
-- RFC-31 R15: no custom role holds an admin-only permission. System roles
-- (is_system) are left alone; none stores either key (RFC-31 R10).
DELETE FROM role_permissions rp USING roles r
WHERE r.id = rp.role_id AND NOT r.is_system
  AND rp.permission_key IN ('dataset.export', 'records.withdraw_imported');
--> statement-breakpoint
-- RFC-63 R13: a withdrawn record leaves every counter its insert fed. The
-- mirror of the insert triggers trait_records_reference_usage() (0015, 0022,
-- 0027) and record_references_usage() (0036), statement by statement:
--   primary_count / secondary_count: one per record naming the reference in
--     that role, plus one primary per record_references row;
--   species_trait_coverage: record_count and harmonised_count per pair, and a
--     pair emptied here is deleted and its species loses the trait (the
--     reverse of the insert's xmax = 0 upsert);
--   reference_traits: the insert's UNION over DISTINCT (record, reference,
--     trait) triples (a reference in both roles counts once), plus one per
--     record_references row counted on its own; a row reaching zero goes.
-- SECURITY DEFINER with the pg_temp-last search_path of 0022 (see its
-- header), owned by the migrator, which owns every counter table; the app role
-- can only read them. Called by the statement trigger below and once by this
-- migration's backfill. The unique index record_annotations_withdraw_idx
-- guarantees one call per record.
CREATE FUNCTION trait_records_uncount(ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION trait_records_uncount(uuid[]) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION record_annotations_withdraw_counters() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM trait_records_uncount(ARRAY(SELECT record_id FROM inserted WHERE kind = 'withdraw'));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION record_annotations_withdraw_counters() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER record_annotations_withdraw_counters AFTER INSERT ON record_annotations
REFERENCING NEW TABLE AS inserted
FOR EACH STATEMENT EXECUTE FUNCTION record_annotations_withdraw_counters();
--> statement-breakpoint
-- Backfill: the records withdrawn before this migration were never
-- decremented. record_annotations_withdraw_idx, created above, already
-- refused a second withdraw of any record, so each is uncounted once.
SELECT trait_records_uncount(ARRAY(SELECT record_id FROM record_annotations WHERE kind = 'withdraw'));

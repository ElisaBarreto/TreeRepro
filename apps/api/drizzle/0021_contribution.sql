DROP INDEX "bibliographic_references_doi_idx";--> statement-breakpoint
ALTER TABLE "record_annotations" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
ALTER TABLE "record_annotations" ADD COLUMN "generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "intent" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "responds_to_record_id" uuid;--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD COLUMN "kind" text DEFAULT 'publication' NOT NULL;--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD COLUMN "observer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "record_annotations" ADD CONSTRAINT "record_annotations_reference_id_bibliographic_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."bibliographic_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_responds_to_record_id_trait_records_id_fk" FOREIGN KEY ("responds_to_record_id") REFERENCES "public"."trait_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD CONSTRAINT "bibliographic_references_observer_user_id_users_id_fk" FOREIGN KEY ("observer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trait_records_responds_to_idx" ON "trait_records" USING btree ("responds_to_record_id") WHERE "trait_records"."responds_to_record_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bibliographic_references_observer_idx" ON "bibliographic_references" USING btree ("observer_user_id") WHERE "bibliographic_references"."kind" = 'personal_observation';--> statement-breakpoint
-- The DOI index moves from the raw column to lower("doi") (RFC-80 R5). Two
-- rows whose DOIs differ only in case are the same reference and have to be
-- merged by hand first: the build below would fail on them, so it says which.
DO $$
DECLARE clashes text;
BEGIN
  SELECT string_agg(format('%s -> %s', canonical, ids), '; ') INTO clashes
  FROM (
    SELECT lower(doi) AS canonical, string_agg(id::text, ', ' ORDER BY id) AS ids
    FROM bibliographic_references
    WHERE doi IS NOT NULL
    GROUP BY lower(doi)
    HAVING count(*) > 1
  ) duplicated;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'bibliographic_references has DOIs that differ only in case; merge them and repoint trait_records before migrating: %', clashes;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "bibliographic_references_doi_idx" ON "bibliographic_references" USING btree (lower("doi")) WHERE "bibliographic_references"."doi" is not null;--> statement-breakpoint
ALTER TABLE "record_annotations" ADD CONSTRAINT "record_annotations_reference_check" CHECK ("record_annotations"."reference_id" is null or "record_annotations"."kind" = 'confirm');--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_intent_check" CHECK (("trait_records"."intent" is null) = ("trait_records"."responds_to_record_id" is null));--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD CONSTRAINT "bibliographic_references_kind_check" CHECK ("bibliographic_references"."kind" in ('publication', 'personal_observation'));--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD CONSTRAINT "bibliographic_references_observer_check" CHECK (("bibliographic_references"."kind" = 'personal_observation') = ("bibliographic_references"."observer_user_id" is not null));

--> statement-breakpoint
-- RFC-63 R2: a response names a record of the same species and trait. Not
-- expressible as a CHECK (it reads another row), so it is a BEFORE INSERT
-- trigger; `trait_records` is append-only, hence no UPDATE trigger.
CREATE FUNCTION trait_records_response_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target trait_records%ROWTYPE;
BEGIN
  IF NEW.responds_to_record_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO target FROM trait_records WHERE id = NEW.responds_to_record_id;
  IF target.id IS NULL THEN RAISE EXCEPTION 'responds_to_record_id % does not exist', NEW.responds_to_record_id; END IF;
  IF target.species_id <> NEW.species_id OR target.trait_id <> NEW.trait_id THEN
    RAISE EXCEPTION 'a response must share the species and trait of the record it responds to';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trait_records_response_check BEFORE INSERT ON trait_records
FOR EACH ROW EXECUTE FUNCTION trait_records_response_check();

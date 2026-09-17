-- RFC-61 R1, R7: reference kinds and personal observation constraint
ALTER TABLE "bibliographic_references" ADD COLUMN "kind" text NOT NULL DEFAULT 'publication';
--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD COLUMN "observer_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD CONSTRAINT "bibliographic_references_observer_user_id_users_id_fk" FOREIGN KEY ("observer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD CONSTRAINT "bibliographic_references_kind_check" CHECK ("bibliographic_references"."kind" in ('publication', 'personal_observation'));
--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD CONSTRAINT "bibliographic_references_observer_check" CHECK (("bibliographic_references"."kind" = 'personal_observation') = ("bibliographic_references"."observer_user_id" is not null));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bibliographic_references_observer_idx" ON "bibliographic_references" ("observer_user_id") WHERE "bibliographic_references"."kind" = 'personal_observation';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bibliographic_references_doi_lower_idx" ON "bibliographic_references" (lower("doi")) WHERE "doi" is not null;
--> statement-breakpoint
-- RFC-63 R1, R2: record intent and responses
ALTER TABLE "trait_records" ADD COLUMN "intent" text;
--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "responds_to_record_id" uuid;
--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_responds_to_record_id_trait_records_id_fk" FOREIGN KEY ("responds_to_record_id") REFERENCES "public"."trait_records"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_intent_check" CHECK (("trait_records"."intent" is null) = ("trait_records"."responds_to_record_id" is null));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trait_records_responds_to_idx" ON "trait_records" ("responds_to_record_id") WHERE "responds_to_record_id" is not null;
--> statement-breakpoint
-- RFC-63 R7: annotation reference (for confirmations) and generated flag
ALTER TABLE "record_annotations" ADD COLUMN "reference_id" uuid;
--> statement-breakpoint
ALTER TABLE "record_annotations" ADD COLUMN "generated" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "record_annotations" ADD CONSTRAINT "record_annotations_reference_id_bibliographic_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."bibliographic_references"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "record_annotations" ADD CONSTRAINT "record_annotations_reference_check" CHECK ("record_annotations"."reference_id" is null or "record_annotations"."kind" = 'confirm');
--> statement-breakpoint
-- RFC-63 R2: a response names a record of the same species and trait.
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

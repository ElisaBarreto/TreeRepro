CREATE TABLE "accepted_values" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"species_id" uuid NOT NULL,
	"trait_id" uuid NOT NULL,
	"record_id" uuid,
	"decision" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accepted_values_record_check" CHECK (("accepted_values"."decision" = 'accepted' and "accepted_values"."record_id" is not null) or ("accepted_values"."decision" = 'cleared' and "accepted_values"."record_id" is null))
);
--> statement-breakpoint
CREATE TABLE "record_annotations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_annotations_note_check" CHECK ("record_annotations"."kind" not in ('dispute', 'withdraw') or "record_annotations"."note" is not null)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"run_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"rows_total" bigint DEFAULT 0 NOT NULL,
	"rows_inserted" bigint DEFAULT 0 NOT NULL,
	"rows_duplicate" bigint DEFAULT 0 NOT NULL,
	"rows_rejected" bigint DEFAULT 0 NOT NULL,
	"rows_pending" bigint DEFAULT 0 NOT NULL,
	"unknown_levels" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rejects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" bigint NOT NULL,
	"reason" text NOT NULL,
	"raw_row" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trait_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"species_id" uuid NOT NULL,
	"trait_id" uuid NOT NULL,
	"level_id" uuid,
	"numeric_value" numeric,
	"value_text" text NOT NULL,
	"harmonisation" text NOT NULL,
	"raw_value" text,
	"original_trait_name" text,
	"original_species_name" text,
	"secondary_source_species_name" text,
	"raw_category" text,
	"primary_reference_id" uuid,
	"secondary_reference_id" uuid,
	"origin" text NOT NULL,
	"import_batch_id" uuid,
	"import_row_no" bigint,
	"created_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trait_records_claim_key" UNIQUE NULLS NOT DISTINCT("species_id","trait_id","value_text","raw_value","primary_reference_id","secondary_reference_id"),
	CONSTRAINT "trait_records_reference_check" CHECK ("trait_records"."primary_reference_id" is not null or "trait_records"."secondary_reference_id" is not null),
	CONSTRAINT "trait_records_origin_check" CHECK (("trait_records"."origin" = 'import' and "trait_records"."import_batch_id" is not null and "trait_records"."import_row_no" is not null and "trait_records"."created_by" is null)
        or ("trait_records"."origin" = 'manual' and "trait_records"."created_by" is not null and "trait_records"."primary_reference_id" is not null and "trait_records"."import_batch_id" is null and "trait_records"."import_row_no" is null)),
	CONSTRAINT "trait_records_harmonised_check" CHECK ("trait_records"."harmonisation" <> 'harmonised' or "trait_records"."level_id" is not null or "trait_records"."numeric_value" is not null),
	CONSTRAINT "trait_records_one_value_check" CHECK ("trait_records"."level_id" is null or "trait_records"."numeric_value" is null)
);
--> statement-breakpoint
ALTER TABLE "accepted_values" ADD CONSTRAINT "accepted_values_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accepted_values" ADD CONSTRAINT "accepted_values_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accepted_values" ADD CONSTRAINT "accepted_values_record_id_trait_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."trait_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accepted_values" ADD CONSTRAINT "accepted_values_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_annotations" ADD CONSTRAINT "record_annotations_record_id_trait_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."trait_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_annotations" ADD CONSTRAINT "record_annotations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rejects" ADD CONSTRAINT "import_rejects_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_level_id_trait_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."trait_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_primary_reference_id_bibliographic_references_id_fk" FOREIGN KEY ("primary_reference_id") REFERENCES "public"."bibliographic_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_secondary_reference_id_bibliographic_references_id_fk" FOREIGN KEY ("secondary_reference_id") REFERENCES "public"."bibliographic_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accepted_values_species_trait_idx" ON "accepted_values" USING btree ("species_id","trait_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "record_annotations_record_idx" ON "record_annotations" USING btree ("record_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_batches_sha_idx" ON "import_batches" USING btree ("file_sha256");--> statement-breakpoint
CREATE INDEX "import_rejects_batch_row_idx" ON "import_rejects" USING btree ("batch_id","row_no");--> statement-breakpoint
CREATE INDEX "trait_records_species_trait_idx" ON "trait_records" USING btree ("species_id","trait_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trait_records_trait_idx" ON "trait_records" USING btree ("trait_id");--> statement-breakpoint
CREATE INDEX "trait_records_primary_reference_idx" ON "trait_records" USING btree ("primary_reference_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trait_records_secondary_reference_idx" ON "trait_records" USING btree ("secondary_reference_id");--> statement-breakpoint
CREATE INDEX "trait_records_batch_idx" ON "trait_records" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "trait_records_pending_idx" ON "trait_records" USING btree ("harmonisation") WHERE "trait_records"."harmonisation" <> 'harmonised';
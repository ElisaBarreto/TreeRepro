-- RFC-63 R1, R2 (plan 07): supersedes_record_id, the converse harmonised check, manual records may inherit references through supersession.
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_origin_check";--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "supersedes_record_id" uuid;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_supersedes_record_id_trait_records_id_fk" FOREIGN KEY ("supersedes_record_id") REFERENCES "public"."trait_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trait_records_supersedes_idx" ON "trait_records" USING btree ("supersedes_record_id") WHERE "trait_records"."supersedes_record_id" is not null;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_value_requires_harmonised_check" CHECK (("trait_records"."level_id" is null and "trait_records"."numeric_value" is null) or "trait_records"."harmonisation" = 'harmonised'), ADD CONSTRAINT "trait_records_origin_check" CHECK (("trait_records"."origin" = 'import' and "trait_records"."import_batch_id" is not null and "trait_records"."import_row_no" is not null and "trait_records"."created_by" is null and "trait_records"."supersedes_record_id" is null)
        or ("trait_records"."origin" = 'manual' and "trait_records"."created_by" is not null and "trait_records"."import_batch_id" is null and "trait_records"."import_row_no" is null
            and ("trait_records"."primary_reference_id" is not null or "trait_records"."supersedes_record_id" is not null)));

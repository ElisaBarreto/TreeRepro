ALTER TABLE "import_batches" ADD COLUMN "rows_filtered" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_unit_status_check";--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_unit_status_check" CHECK ("trait_records"."unit_status" is null or "trait_records"."unit_status" in ('converted_or_already_target', 'unit_missing', 'needs_unit_check', 'not_applicable', 'not_numeric'));--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_outlier_flag_check";--> statement-breakpoint
-- NOT VALID: records loaded before release v1 keep 'species_disagreement' or
-- 'both' until the reload replaces them (RFC-63 R1); new rows are checked.
-- drizzle-kit wrote this statement cut at the ';' inside 'unit_factor;trait_extreme'.
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_outlier_flag_check" CHECK ("trait_records"."outlier_flag" is null or "trait_records"."outlier_flag" in ('unit_factor', 'trait_extreme', 'unit_factor;trait_extreme')) NOT VALID;

ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_one_value_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_value_requires_harmonised_check";--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "se_value" numeric;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "statistic" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "unit_status" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "source_folder" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "source_file" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "taxonomic_status" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "folded_record_codes" text[];--> statement-breakpoint
ALTER TABLE "families" ADD COLUMN "order_name" text;--> statement-breakpoint
ALTER TABLE "import_rejects" ADD CONSTRAINT "import_rejects_reason_check" CHECK ("import_rejects"."reason" in ('no_species_name', 'unknown_trait', 'no_reference', 'unknown_species', 'unknown_plot', 'unknown_user', 'unknown_reference', 'doi_taken', 'invalid_value', 'invalid_record_id', 'duplicate_record_id', 'invalid_measurement'));--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_se_check" CHECK ("trait_records"."se_value" is null or "trait_records"."se_value" >= 0);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_statistic_check" CHECK ("trait_records"."statistic" is null or "trait_records"."statistic" in ('single_or_unspecified', 'mean', 'median', 'derived_midpoint'));--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_unit_status_check" CHECK ("trait_records"."unit_status" is null or "trait_records"."unit_status" in ('converted_or_already_target', 'unit_missing', 'needs_unit_check', 'not_applicable'));--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_statistic_quantitative_check" CHECK ("trait_records"."statistic" is null or "trait_records"."level_id" is null);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_one_value_check" CHECK ("trait_records"."level_id" is null or num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."sd_value", "trait_records"."se_value", "trait_records"."n") = 0);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_value_requires_harmonised_check" CHECK (("trait_records"."level_id" is null and num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."sd_value", "trait_records"."se_value", "trait_records"."n") = 0)
        or "trait_records"."harmonisation" = 'harmonised');
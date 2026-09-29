ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_claim_key";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_statistic_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_statistic_quantitative_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_statistic_value_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_harmonised_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_one_value_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_value_requires_harmonised_check";--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "median_value" numeric;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "gbif_genus" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "gbif_family" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "taxon_order" text;--> statement-breakpoint
ALTER TABLE "trait_records" DROP COLUMN "statistic";--> statement-breakpoint
ALTER TABLE "trait_records" DROP COLUMN "folded_record_codes";--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_claim_key" UNIQUE NULLS NOT DISTINCT("species_id","trait_id","value_text","raw_value","primary_reference_id","secondary_reference_id");--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_harmonised_check" CHECK ("trait_records"."harmonisation" <> 'harmonised' or "trait_records"."level_id" is not null
        or coalesce("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."median_value") is not null);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_one_value_check" CHECK ("trait_records"."level_id" is null or num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."median_value", "trait_records"."sd_value", "trait_records"."se_value", "trait_records"."n") = 0);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_value_requires_harmonised_check" CHECK (("trait_records"."level_id" is null and num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."median_value", "trait_records"."sd_value", "trait_records"."se_value", "trait_records"."n") = 0)
        or "trait_records"."harmonisation" = 'harmonised');
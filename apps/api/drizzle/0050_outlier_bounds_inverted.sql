ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_outlier_flag_check";--> statement-breakpoint
-- NOT VALID, as in 0048: records loaded before release v1 may still hold a
-- pre-v1 value until the reload (RFC-63 R1). drizzle-kit cuts this statement at
-- the ';' inside 'unit_factor;trait_extreme', so it is written by hand.
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_outlier_flag_check" CHECK ("trait_records"."outlier_flag" is null or "trait_records"."outlier_flag" in ('unit_factor', 'trait_extreme', 'unit_factor;trait_extreme', 'bounds_inverted')) NOT VALID;

ALTER TABLE "trait_records" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "summary_source" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "records_behind_row" integer;--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_summary_source_check" CHECK ("trait_records"."summary_source" is null or "trait_records"."summary_source" in ('reported_by_study', 'derived_from_records', 'reported_and_derived'));--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_records_behind_row_check" CHECK ("trait_records"."records_behind_row" is null or "trait_records"."records_behind_row" >= 1);
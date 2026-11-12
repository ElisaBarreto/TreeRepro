ALTER TABLE "wcvp_distribution" ADD COLUMN "introduced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wcvp_regions" ADD COLUMN "region_code_l2" text;--> statement-breakpoint
ALTER TABLE "wcvp_regions" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "wcvp_regions" ADD COLUMN "continent_code_l1" text;--> statement-breakpoint
ALTER TABLE "wcvp_regions" ADD COLUMN "continent" text;
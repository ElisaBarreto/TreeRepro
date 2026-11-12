-- RFC-60 R1 (plan 15d): every species has a plant type and a review status.
-- Every existing species is a reviewed tree; the defaults exist only for the
-- backfill, so every later insert states both.
ALTER TABLE "species" ADD COLUMN "plant_type" text DEFAULT 'tree' NOT NULL;--> statement-breakpoint
ALTER TABLE "species" ADD COLUMN "plant_type_status" text DEFAULT 'reviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "species" ALTER COLUMN "plant_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "species" ALTER COLUMN "plant_type_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_plant_type_check" CHECK ("species"."plant_type" in ('tree', 'not_tree'));--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_plant_type_status_check" CHECK ("species"."plant_type_status" in ('proposed', 'reviewed'));--> statement-breakpoint
CREATE INDEX "species_plant_type_idx" ON "species" USING btree ("plant_type","plant_type_status");--> statement-breakpoint
-- RFC-75 R1: a proposal states its plant type; rows made before this migration have none.
ALTER TABLE "species_proposals" ADD COLUMN "plant_type" text;--> statement-breakpoint
ALTER TABLE "species_proposals" ADD CONSTRAINT "species_proposals_plant_type_check" CHECK ("species_proposals"."plant_type" in ('tree', 'not_tree'));

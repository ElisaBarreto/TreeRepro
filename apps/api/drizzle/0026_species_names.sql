ALTER TABLE "species_names" ADD COLUMN "name_type" text DEFAULT 'gbif' NOT NULL;--> statement-breakpoint
ALTER TABLE "species_names" ADD COLUMN "language" char(2);--> statement-breakpoint
ALTER TABLE "species_names" ADD CONSTRAINT "species_names_type_check" CHECK ("species_names"."name_type" in ('gbif', 'synonym', 'common'));--> statement-breakpoint
ALTER TABLE "species_names" ADD CONSTRAINT "species_names_language_check" CHECK (("species_names"."name_type" = 'common') = ("species_names"."language" is not null));--> statement-breakpoint
ALTER TABLE "species_names" ADD CONSTRAINT "species_names_gbif_key_check" CHECK ("species_names"."gbif_usage_key" is null or "species_names"."name_type" = 'gbif');
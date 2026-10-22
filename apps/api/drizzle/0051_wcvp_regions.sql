CREATE TABLE "wcvp_distribution" (
	"plant_name_id" text NOT NULL,
	"area_code_l3" text NOT NULL,
	CONSTRAINT "wcvp_distribution_plant_name_id_area_code_l3_pk" PRIMARY KEY("plant_name_id","area_code_l3")
);
--> statement-breakpoint
CREATE TABLE "wcvp_regions" (
	"area_code_l3" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wcvp_species" (
	"plant_name_id" text PRIMARY KEY NOT NULL,
	"taxon_name" text NOT NULL,
	"is_tree" boolean NOT NULL,
	"file_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wcvp_distribution" ADD CONSTRAINT "wcvp_distribution_plant_name_id_wcvp_species_plant_name_id_fk" FOREIGN KEY ("plant_name_id") REFERENCES "public"."wcvp_species"("plant_name_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wcvp_distribution" ADD CONSTRAINT "wcvp_distribution_area_code_l3_wcvp_regions_area_code_l3_fk" FOREIGN KEY ("area_code_l3") REFERENCES "public"."wcvp_regions"("area_code_l3") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wcvp_distribution_area_idx" ON "wcvp_distribution" USING btree ("area_code_l3");--> statement-breakpoint
CREATE INDEX "wcvp_species_taxon_name_idx" ON "wcvp_species" USING btree ("taxon_name","file_order");--> statement-breakpoint
CREATE VIEW "public"."wcvp_species_match" AS (
  select distinct on (s.id) s.id as species_id, w.plant_name_id
  from species s
  join wcvp_species w on w.taxon_name = trim(regexp_replace(s.canonical_name, '\s+', ' ', 'g'))
  order by s.id, w.file_order);--> statement-breakpoint
-- RFC-78 R2: import:wcvp runs as the app role and replaces the load with
-- TRUNCATE, which the default privileges (DML only) do not grant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    GRANT TRUNCATE ON wcvp_species, wcvp_regions, wcvp_distribution TO treerepro_app;
  END IF;
END
$$;
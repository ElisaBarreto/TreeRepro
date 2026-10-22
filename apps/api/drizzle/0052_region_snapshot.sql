CREATE TABLE "region_categorical" (
	"trait_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	"area_code_l3" text NOT NULL,
	"n_species_with_level" integer NOT NULL,
	"n_species_with_trait" integer NOT NULL,
	CONSTRAINT "region_categorical_trait_id_level_id_area_code_l3_pk" PRIMARY KEY("trait_id","level_id","area_code_l3")
);
--> statement-breakpoint
CREATE TABLE "region_completeness" (
	"trait_id" uuid NOT NULL,
	"area_code_l3" text NOT NULL,
	"species_with_data" integer NOT NULL,
	"wcvp_species" integer NOT NULL,
	"wcvp_tree_species" integer NOT NULL,
	CONSTRAINT "region_completeness_trait_id_area_code_l3_pk" PRIMARY KEY("trait_id","area_code_l3")
);
--> statement-breakpoint
CREATE TABLE "region_continuous" (
	"trait_id" uuid NOT NULL,
	"area_code_l3" text NOT NULL,
	"n_species" integer NOT NULL,
	"mean" double precision NOT NULL,
	"sd" double precision,
	"median" double precision NOT NULL,
	"min" double precision NOT NULL,
	"max" double precision NOT NULL,
	"cv" double precision,
	CONSTRAINT "region_continuous_trait_id_area_code_l3_pk" PRIMARY KEY("trait_id","area_code_l3")
);
--> statement-breakpoint
CREATE TABLE "region_snapshot" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "region_snapshot_one_row" CHECK ("region_snapshot"."id")
);
--> statement-breakpoint
ALTER TABLE "job_runs" DROP CONSTRAINT "job_runs_kind_check";--> statement-breakpoint
ALTER TABLE "region_categorical" ADD CONSTRAINT "region_categorical_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_categorical" ADD CONSTRAINT "region_categorical_level_id_trait_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."trait_levels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_completeness" ADD CONSTRAINT "region_completeness_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_continuous" ADD CONSTRAINT "region_continuous_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_kind_check" CHECK ("job_runs"."kind" in ('audit_purge', 'digest', 'snapshot'));
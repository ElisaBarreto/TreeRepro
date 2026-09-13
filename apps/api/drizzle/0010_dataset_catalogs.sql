CREATE TABLE "trait_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trait_levels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"trait_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "traits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"category_key" text NOT NULL,
	"value_type" text NOT NULL,
	"unit" text,
	"description" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "traits_value_type_check" CHECK ("traits"."value_type" in ('categorical', 'quantitative'))
);
--> statement-breakpoint
CREATE TABLE "bibliographic_references" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"citation_key" text NOT NULL,
	"title" text,
	"authors" text,
	"year" smallint,
	"journal" text,
	"doi" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "genera" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "species" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"genus_id" uuid,
	"canonical_name" text NOT NULL,
	"name_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "species_name_source_check" CHECK ("species"."name_source" in ('wcvp', 'gbif', 'original'))
);
--> statement-breakpoint
CREATE TABLE "species_names" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"species_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text DEFAULT 'gbif' NOT NULL,
	"gbif_usage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trait_levels" ADD CONSTRAINT "trait_levels_trait_id_traits_id_fk" FOREIGN KEY ("trait_id") REFERENCES "public"."traits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_levels" ADD CONSTRAINT "trait_levels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traits" ADD CONSTRAINT "traits_category_key_trait_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "public"."trait_categories"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traits" ADD CONSTRAINT "traits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bibliographic_references" ADD CONSTRAINT "bibliographic_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genera" ADD CONSTRAINT "genera_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genera" ADD CONSTRAINT "genera_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_genus_id_genera_id_fk" FOREIGN KEY ("genus_id") REFERENCES "public"."genera"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species_names" ADD CONSTRAINT "species_names_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trait_levels_trait_key_idx" ON "trait_levels" USING btree ("trait_id",lower("key"));--> statement-breakpoint
CREATE UNIQUE INDEX "traits_key_idx" ON "traits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "traits_category_idx" ON "traits" USING btree ("category_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bibliographic_references_citation_key_idx" ON "bibliographic_references" USING btree ("citation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bibliographic_references_doi_idx" ON "bibliographic_references" USING btree ("doi") WHERE "bibliographic_references"."doi" is not null;--> statement-breakpoint
CREATE INDEX "bibliographic_references_citation_key_trgm_idx" ON "bibliographic_references" USING gin ("citation_key" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "families_name_idx" ON "families" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "genera_name_idx" ON "genera" USING btree ("name");--> statement-breakpoint
CREATE INDEX "genera_family_idx" ON "genera" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "species_canonical_name_idx" ON "species" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX "species_canonical_name_trgm_idx" ON "species" USING gin ("canonical_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "species_genus_idx" ON "species" USING btree ("genus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "species_names_species_name_idx" ON "species_names" USING btree ("species_id","name");--> statement-breakpoint
CREATE INDEX "species_names_name_trgm_idx" ON "species_names" USING gin ("name" gin_trgm_ops);
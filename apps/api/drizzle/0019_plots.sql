CREATE TABLE "plot_species" (
	"plot_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plot_species_plot_id_species_id_pk" PRIMARY KEY("plot_id","species_id")
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"country" text,
	"biome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plots_latitude_check" CHECK ("plots"."latitude" is null or "plots"."latitude" between -90 and 90),
	CONSTRAINT "plots_longitude_check" CHECK ("plots"."longitude" is null or "plots"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "user_plots" (
	"user_id" uuid NOT NULL,
	"plot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_plots_user_id_plot_id_pk" PRIMARY KEY("user_id","plot_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restrict_to_assigned_plots" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plot_species" ADD CONSTRAINT "plot_species_plot_id_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_species" ADD CONSTRAINT "plot_species_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plots" ADD CONSTRAINT "user_plots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plots" ADD CONSTRAINT "user_plots_plot_id_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plot_species_species_idx" ON "plot_species" USING btree ("species_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plots_code_lower_idx" ON "plots" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "user_plots_plot_idx" ON "user_plots" USING btree ("plot_id");
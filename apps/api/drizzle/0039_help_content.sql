CREATE TABLE "help_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"topic_id" uuid NOT NULL,
	"anchor" text,
	"title" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_topics" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "help_sections" ADD CONSTRAINT "help_sections_topic_id_help_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."help_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "help_sections_topic_anchor_idx" ON "help_sections" USING btree ("topic_id","anchor");--> statement-breakpoint
-- RFC-30 R3: the catalog row for help.edit (RFC-73 R6, R7). No seeded role
-- stores it: admin holds every permission (RFC-31 R2, R10).
INSERT INTO permissions (key, description) VALUES
  ('help.edit', 'Create, edit and delete help pages')
ON CONFLICT (key) DO NOTHING;

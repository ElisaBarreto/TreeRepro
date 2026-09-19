CREATE TABLE "species_proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposed_name" text NOT NULL,
	"note" text,
	"proposer_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"lookup" jsonb,
	"lookup_at" timestamp with time zone,
	"species_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "species_proposals_status_check" CHECK ("species_proposals"."status" in ('open', 'approved', 'rejected')),
	CONSTRAINT "species_proposals_open_check" CHECK (("species_proposals"."status" = 'open') = ("species_proposals"."decided_at" is null)),
	CONSTRAINT "species_proposals_approved_check" CHECK (("species_proposals"."status" = 'approved') = ("species_proposals"."species_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "species_proposals" ADD CONSTRAINT "species_proposals_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species_proposals" ADD CONSTRAINT "species_proposals_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species_proposals" ADD CONSTRAINT "species_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "species_proposals_open_name_idx" ON "species_proposals" USING btree (lower("proposed_name")) WHERE "species_proposals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "species_proposals_status_idx" ON "species_proposals" USING btree ("status","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "species_proposals_proposer_idx" ON "species_proposals" USING btree ("proposer_id","id" DESC NULLS LAST);
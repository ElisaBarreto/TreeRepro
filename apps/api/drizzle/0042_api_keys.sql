CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id","created_at");
--> statement-breakpoint
-- RFC-82 R1: keys are revoked, never deleted. Stated explicitly rather than
-- left to the migrator's default privileges (infra/postgres/init/01-roles.sh,
-- which also grants DELETE). Guarded like 0029: the role is absent in a bare
-- drizzle-kit check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'treerepro_app') THEN
    REVOKE DELETE, TRUNCATE ON api_keys FROM treerepro_app;
    GRANT SELECT, INSERT, UPDATE ON api_keys TO treerepro_app;
  END IF;
END;
$$;
-- RFC-31 R16 (plan 15c): roles are assigned per platform. Every existing row
-- is a TreeRepro role; `admin` is held on both platforms, so every holder
-- also gets its `plantrepro` row. The default exists only for the backfill.
ALTER TABLE "user_roles" ADD COLUMN "platform" text DEFAULT 'treerepro' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ALTER COLUMN "platform" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_platform_check" CHECK ("user_roles"."platform" in ('treerepro', 'plantrepro'));--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_role_id_pk";--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_role_id_platform_pk" PRIMARY KEY("user_id","role_id","platform");--> statement-breakpoint
INSERT INTO "user_roles" ("user_id", "role_id", "platform", "created_at")
SELECT ur."user_id", ur."role_id", 'plantrepro', ur."created_at"
FROM "user_roles" ur
JOIN "roles" r ON r."id" = ur."role_id"
WHERE r."name" = 'admin' AND r."is_system"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- RFC-20 R5: an invitation names its platform; a pending one (null) is TreeRepro's.
ALTER TABLE "auth_tokens" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_platform_check" CHECK ("auth_tokens"."platform" in ('treerepro', 'plantrepro'));

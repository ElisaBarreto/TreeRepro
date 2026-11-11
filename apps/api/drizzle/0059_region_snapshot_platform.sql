-- RFC-78 R7, R8 (plan 15f): the region snapshot is built per platform. Every
-- existing row was computed over TreeRepro's scope; the default exists only
-- for the backfill, so every later insert states the platform.
ALTER TABLE "region_categorical" ADD COLUMN "platform" text DEFAULT 'treerepro' NOT NULL;--> statement-breakpoint
ALTER TABLE "region_completeness" ADD COLUMN "platform" text DEFAULT 'treerepro' NOT NULL;--> statement-breakpoint
ALTER TABLE "region_continuous" ADD COLUMN "platform" text DEFAULT 'treerepro' NOT NULL;--> statement-breakpoint
ALTER TABLE "region_snapshot" ADD COLUMN "platform" text DEFAULT 'treerepro' NOT NULL;--> statement-breakpoint
ALTER TABLE "region_categorical" ALTER COLUMN "platform" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "region_completeness" ALTER COLUMN "platform" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "region_continuous" ALTER COLUMN "platform" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "region_snapshot" ALTER COLUMN "platform" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "region_categorical" ADD CONSTRAINT "region_categorical_platform_check" CHECK ("region_categorical"."platform" in ('treerepro', 'plantrepro'));--> statement-breakpoint
ALTER TABLE "region_completeness" ADD CONSTRAINT "region_completeness_platform_check" CHECK ("region_completeness"."platform" in ('treerepro', 'plantrepro'));--> statement-breakpoint
ALTER TABLE "region_continuous" ADD CONSTRAINT "region_continuous_platform_check" CHECK ("region_continuous"."platform" in ('treerepro', 'plantrepro'));--> statement-breakpoint
ALTER TABLE "region_snapshot" ADD CONSTRAINT "region_snapshot_platform_check" CHECK ("region_snapshot"."platform" in ('treerepro', 'plantrepro'));--> statement-breakpoint
ALTER TABLE "region_categorical" DROP CONSTRAINT "region_categorical_trait_id_level_id_area_code_l3_pk";--> statement-breakpoint
ALTER TABLE "region_completeness" DROP CONSTRAINT "region_completeness_trait_id_area_code_l3_pk";--> statement-breakpoint
ALTER TABLE "region_continuous" DROP CONSTRAINT "region_continuous_trait_id_area_code_l3_pk";--> statement-breakpoint
ALTER TABLE "region_snapshot" DROP CONSTRAINT "region_snapshot_pkey";--> statement-breakpoint
ALTER TABLE "region_categorical" ADD CONSTRAINT "region_categorical_platform_trait_id_level_id_area_code_l3_pk" PRIMARY KEY("platform","trait_id","level_id","area_code_l3");--> statement-breakpoint
ALTER TABLE "region_completeness" ADD CONSTRAINT "region_completeness_platform_trait_id_area_code_l3_pk" PRIMARY KEY("platform","trait_id","area_code_l3");--> statement-breakpoint
ALTER TABLE "region_continuous" ADD CONSTRAINT "region_continuous_platform_trait_id_area_code_l3_pk" PRIMARY KEY("platform","trait_id","area_code_l3");--> statement-breakpoint
ALTER TABLE "region_snapshot" ADD CONSTRAINT "region_snapshot_id_platform_pk" PRIMARY KEY("id","platform");

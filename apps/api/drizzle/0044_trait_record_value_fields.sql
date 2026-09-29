ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_claim_key";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_statistic_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_statistic_quantitative_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_statistic_value_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_harmonised_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_one_value_check";--> statement-breakpoint
ALTER TABLE "trait_records" DROP CONSTRAINT "trait_records_value_requires_harmonised_check";--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "median_value" numeric;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "gbif_genus" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "gbif_family" text;--> statement-breakpoint
ALTER TABLE "trait_records" ADD COLUMN "taxon_order" text;--> statement-breakpoint
-- RFC-63 R15, issue #232: a value the import labelled `mean` or `median` moves
-- into its own field, a `derived_midpoint` with a bound is dropped (the import
-- never computes a midpoint), and the moved rows get the value_text of the new
-- fields (single, min, max, mean, median, sd, se, n), so a single, a mean and a
-- median of one number stay three claims once the claim key loses `statistic`.
-- A midpoint with no bound, or whose cleared form would repeat another claim,
-- keeps its number as a single value: the first would leave a harmonised
-- record with no value, the second would break the re-added claim key, and the
-- append-only table allows no delete. Among midpoints whose cleared forms
-- match, the smallest id is cleared, unless a row that is not a bounded
-- midpoint already holds that claim. The claim key is dropped above, so the
-- rewrite cannot collide on the way. One ALTER with USING rewrites the table:
-- every USING reads the original row, no UPDATE runs, and the RFC-63 R4
-- append-only triggers never fire (the 0036 technique). USING takes no
-- subquery, so it reads the kept ids through a temporary function.
CREATE TEMPORARY TABLE "m44_kept_ids" ("id" uuid PRIMARY KEY);--> statement-breakpoint
INSERT INTO "m44_kept_ids"
SELECT "id" FROM (
  SELECT "id", "bounded", row_number() OVER (
      PARTITION BY "species_id", "trait_id", "text", "raw_value", "primary_reference_id", "secondary_reference_id"
      ORDER BY "bounded", "id") AS "rn"
  FROM (
    SELECT "id", "species_id", "trait_id", "raw_value", "primary_reference_id", "secondary_reference_id",
      coalesce(("statistic" = 'derived_midpoint' and num_nonnulls("min_value", "max_value") > 0), false) AS "bounded",
      case when "statistic" in ('mean', 'median') or ("statistic" = 'derived_midpoint' and num_nonnulls("min_value", "max_value") > 0) then concat_ws(';',
    'min=' || "min_value"::text,
    'max=' || "max_value"::text,
    'mean=' || (case when "statistic" = 'mean' then "numeric_value" else "mean_value" end)::text,
    'median=' || (case when "statistic" = 'median' then "numeric_value" else "median_value" end)::text,
    'sd=' || "sd_value"::text,
    'se=' || "se_value"::text,
    'n=' || "n"::text) else "value_text" end AS "text"
    FROM "trait_records"
    WHERE ("species_id", "trait_id") IN (
      SELECT "species_id", "trait_id" FROM "trait_records" WHERE ("statistic" = 'derived_midpoint' and num_nonnulls("min_value", "max_value") > 0))
  ) "f"
) "k"
WHERE "bounded" AND "rn" > 1;--> statement-breakpoint
CREATE FUNCTION pg_temp.m44_kept(uuid) RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM pg_temp."m44_kept_ids" WHERE "id" = $1) $$;--> statement-breakpoint
ALTER TABLE "trait_records"
  ALTER COLUMN "mean_value" TYPE numeric USING (case when "statistic" = 'mean' then "numeric_value" else "mean_value" end),
  ALTER COLUMN "median_value" TYPE numeric USING (case when "statistic" = 'median' then "numeric_value" else "median_value" end),
  ALTER COLUMN "numeric_value" TYPE numeric USING (case when ("statistic" in ('mean', 'median') or (("statistic" = 'derived_midpoint' and num_nonnulls("min_value", "max_value") > 0) and not pg_temp.m44_kept("id"))) then null else "numeric_value" end),
  ALTER COLUMN "value_text" TYPE text USING (case when ("statistic" in ('mean', 'median') or (("statistic" = 'derived_midpoint' and num_nonnulls("min_value", "max_value") > 0) and not pg_temp.m44_kept("id"))) then concat_ws(';',
    'min=' || "min_value"::text,
    'max=' || "max_value"::text,
    'mean=' || (case when "statistic" = 'mean' then "numeric_value" else "mean_value" end)::text,
    'median=' || (case when "statistic" = 'median' then "numeric_value" else "median_value" end)::text,
    'sd=' || "sd_value"::text,
    'se=' || "se_value"::text,
    'n=' || "n"::text) else "value_text" end);--> statement-breakpoint
DROP FUNCTION pg_temp.m44_kept(uuid);--> statement-breakpoint
DROP TABLE "m44_kept_ids";--> statement-breakpoint
ALTER TABLE "trait_records" DROP COLUMN "statistic";--> statement-breakpoint
ALTER TABLE "trait_records" DROP COLUMN "folded_record_codes";--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_claim_key" UNIQUE NULLS NOT DISTINCT("species_id","trait_id","value_text","raw_value","primary_reference_id","secondary_reference_id");--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_harmonised_check" CHECK ("trait_records"."harmonisation" <> 'harmonised' or "trait_records"."level_id" is not null
        or coalesce("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."median_value") is not null);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_one_value_check" CHECK ("trait_records"."level_id" is null or num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."median_value", "trait_records"."sd_value", "trait_records"."se_value", "trait_records"."n") = 0);--> statement-breakpoint
ALTER TABLE "trait_records" ADD CONSTRAINT "trait_records_value_requires_harmonised_check" CHECK (("trait_records"."level_id" is null and num_nonnulls("trait_records"."numeric_value", "trait_records"."min_value", "trait_records"."max_value", "trait_records"."mean_value", "trait_records"."median_value", "trait_records"."sd_value", "trait_records"."se_value", "trait_records"."n") = 0)
        or "trait_records"."harmonisation" = 'harmonised');
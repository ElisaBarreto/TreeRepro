-- RFC-60 R1, R6: the accent-, case- and punctuation-free key the species
-- search compares. unaccent is a trusted extension, like pg_trgm (0009); the
-- dictionary is named so the function is immutable and indexable.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE FUNCTION search_key(text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, $1)), '[^[:alnum:]]+', '', 'g');--> statement-breakpoint
ALTER TABLE "species_names" DROP CONSTRAINT "species_names_language_check";--> statement-breakpoint
CREATE INDEX "species_search_key_trgm_idx" ON "species" USING gin (search_key("canonical_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "species_names_search_key_trgm_idx" ON "species_names" USING gin (search_key("name") gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "species_names" ADD CONSTRAINT "species_names_language_check" CHECK ("species_names"."language" is null or "species_names"."name_type" = 'common');
-- RFC-62 R7: the trait detail's acceptedCount reads accepted_values by
-- trait_id alone (`distinct on (species_id) … where trait_id = $1 order by
-- species_id, id desc`). The only index so far leads with species_id, so that
-- predicate cannot use it and the query scans the table — cheap while curation
-- starts, growing with every decision and never shrinking (#97). trait_id leads
-- here; the tail matches the query's ordering, so one index serves both.
CREATE INDEX "accepted_values_trait_idx" ON "accepted_values" USING btree ("trait_id","species_id","id" DESC NULLS LAST);

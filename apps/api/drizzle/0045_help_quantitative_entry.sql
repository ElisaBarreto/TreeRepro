-- Issue #237: the Workflow help still said a quantitative entry matching an
-- existing record counts as a validation (RFC-70 R3, amended by #233). Only
-- the seeded paragraph is replaced; a section already edited on the site
-- (RFC-73 R5) no longer holds it and is left alone.
UPDATE "help_sections" SET
  "body_html" = replace("body_html", $old$<p>If your entry matches a record that is already there (the same level, or the same numbers in all six fields), no second record is created. Your entry counts as a validation of the existing record, and the form says so: “matches an existing record — counted as your validation”. If the matching record is your own, the form only reports it: “already your own record — nothing was added”.</p>$old$, $new$<p>On a categorical trait, ticking a level that already has records creates no second record: your entry counts as a validation of those records, and the form says so: “matches an existing record — counted as your validation”. A quantitative value always becomes a record of its own, even when it equals a value already there; to agree with an existing value without a measurement of your own, <a href="/app/help/workflow#validate">validate</a> it instead. If the same claim is already recorded — the same value under the same references — nothing is added, and the form says so: “already recorded — nothing was added”.</p>$new$),
  "updated_at" = now()
WHERE "anchor" = 'different'
  AND "topic_id" = (SELECT "id" FROM "help_topics" WHERE "slug" = 'workflow')
  AND strpos("body_html", $old$<p>If your entry matches a record that is already there (the same level, or the same numbers in all six fields), no second record is created. Your entry counts as a validation of the existing record, and the form says so: “matches an existing record — counted as your validation”. If the matching record is your own, the form only reports it: “already your own record — nothing was added”.</p>$old$) > 0;

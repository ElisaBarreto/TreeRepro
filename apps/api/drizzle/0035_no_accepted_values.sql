DROP TABLE "accepted_values" CASCADE;
--> statement-breakpoint
-- Spec R-1 (RFC-63 R11, RFC-65 R6): the trigger function served
-- accepted_values alone; its trigger went with the table.
DROP FUNCTION accepted_values_match_record();
--> statement-breakpoint
-- RFC-30 R3: accepted.manage leaves the catalog. Any custom role may hold it,
-- and role_permissions references permissions without a cascade.
DELETE FROM role_permissions WHERE permission_key = 'accepted.manage';
--> statement-breakpoint
DELETE FROM permissions WHERE key = 'accepted.manage';
--> statement-breakpoint
UPDATE permissions SET description = 'Download the dataset' WHERE key = 'dataset.export';

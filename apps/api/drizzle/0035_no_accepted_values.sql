DROP TABLE "accepted_values" CASCADE;
--> statement-breakpoint
-- Spec R-1 (RFC-63 R11, RFC-65 R6): the trigger function served
-- accepted_values alone; its trigger went with the table.
DROP FUNCTION accepted_values_match_record();
--> statement-breakpoint
-- RFC-30 R1: a retired key keeps its row; grants are kept too (as 0006 did
-- for users.delete) since no route checks the key.
UPDATE permissions SET description = 'Set and clear the accepted value per species and trait (retired)' WHERE key = 'accepted.manage';
--> statement-breakpoint
UPDATE permissions SET description = 'Download the dataset' WHERE key = 'dataset.export';

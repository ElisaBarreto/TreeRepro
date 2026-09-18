-- RFC-30 R3: the catalog row for plan 11a (RFC-71).
INSERT INTO permissions (key, description) VALUES
  ('contributions.read', 'View any user''s contributions')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- RFC-31 R10: manager gains contributions.read.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p
WHERE lower(r.name) = 'manager' AND p.key = 'contributions.read'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- RFC-71 R4: one query per number over indexed columns.
CREATE INDEX record_annotations_actor_idx ON record_annotations (actor_id, id DESC);
--> statement-breakpoint
CREATE INDEX trait_records_created_by_idx ON trait_records (created_by, id DESC) WHERE created_by IS NOT NULL;

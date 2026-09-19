-- RFC-30 R3: the catalog row for plan 12c (RFC-75 R2, R5).
INSERT INTO permissions (key, description) VALUES
  ('taxa.propose', 'Propose a species for the catalog')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- RFC-31 R10: contributor and manager both gain taxa.propose.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p
WHERE lower(r.name) IN ('contributor', 'manager') AND p.key = 'taxa.propose'
ON CONFLICT DO NOTHING;

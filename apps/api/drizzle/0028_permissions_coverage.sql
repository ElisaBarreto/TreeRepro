-- RFC-30 R3: the catalog row for plan 11c (RFC-69 R5-R7).
INSERT INTO permissions (key, description) VALUES
  ('coverage.read', 'View coverage metrics')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- RFC-31 R10: manager gains coverage.read.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p
WHERE lower(r.name) = 'manager' AND p.key = 'coverage.read'
ON CONFLICT DO NOTHING;

-- RFC-30 R3: dataset.read_inactive (RFC-33, plan 08a).
INSERT INTO permissions (key, description) VALUES
  ('dataset.read_inactive', 'See inactive species, traits and levels'),
  ('records.review', 'Work the harmonisation and disputed queues')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- RFC-31 R2, R10: the manager and contributor system roles with their stored permissions.
INSERT INTO roles (name, description, is_system) VALUES
  ('contributor', 'Browses the active catalog, validates records and adds entries.', true),
  ('manager', 'Everything a contributor does, plus inactive species and traits, the queues and withdrawals.', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p
WHERE r.name = 'contributor' AND p.key IN ('dataset.read', 'records.create', 'records.annotate')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r, permissions p
WHERE r.name = 'manager' AND p.key IN ('dataset.read', 'records.create', 'records.annotate', 'dataset.read_inactive', 'records.review', 'records.withdraw', 'imports.read')
ON CONFLICT DO NOTHING;

-- RFC-30 R3: the catalog row for plan 12d (RFC-52 R1).
INSERT INTO permissions (key, description) VALUES
  ('health.read', 'View platform health')
ON CONFLICT (key) DO NOTHING;

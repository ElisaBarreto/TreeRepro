-- RFC-30 R3: the catalog row for plan 08b (RFC-67).
INSERT INTO permissions (key, description) VALUES
  ('plots.manage', 'Create and edit field plots and their species')
ON CONFLICT (key) DO NOTHING;
-- RFC-30 R3: the catalog rows for plan 06 (RFC-60–64).
INSERT INTO permissions (key, description) VALUES
  ('dataset.read', 'Browse species, traits, references and records'),
  ('imports.read', 'View import batches and their rejections')
ON CONFLICT (key) DO NOTHING;

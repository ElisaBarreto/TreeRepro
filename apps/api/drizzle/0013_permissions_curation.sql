-- RFC-30 R3: the catalog rows for plan 07 (RFC-65, RFC-66).
INSERT INTO permissions (key, description) VALUES
  ('records.create', 'Add trait records and map pending values'),
  ('records.annotate', 'Confirm, dispute and comment on records'),
  ('records.withdraw', 'Withdraw any manual record'),
  ('accepted.manage', 'Set and clear the accepted value per species and trait'),
  ('taxa.manage', 'Create and edit families, genera, species and names'),
  ('references.manage', 'Create and edit bibliographic references'),
  ('traits.manage', 'Create and edit traits and levels'),
  ('dataset.export', 'Download the accepted values')
ON CONFLICT (key) DO NOTHING;

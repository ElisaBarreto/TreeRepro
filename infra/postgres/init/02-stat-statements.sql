-- Per-query statistics for finding slow queries (docs/gotchas/postgres.md
-- "Finding slow queries"); the library is preloaded by compose.yml.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

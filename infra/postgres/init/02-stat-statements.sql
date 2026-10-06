-- Per-query statistics for finding slow queries (docs/gotchas/postgres.md
-- "Finding slow queries"); the library is preloaded by compose.yml. Created in
-- the `postgres` database, not `treerepro`: the view still covers every
-- database, and pg_dump of `treerepro` then carries no extension that the
-- migrator (not a superuser) could not restore.
\c postgres
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

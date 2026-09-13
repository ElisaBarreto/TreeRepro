-- RFC-10 R14: trigram indexes for the substring searches of RFC-60 R6 and RFC-61 R4.
-- pg_trgm is a trusted extension; treerepro_migrator holds CREATE on the database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

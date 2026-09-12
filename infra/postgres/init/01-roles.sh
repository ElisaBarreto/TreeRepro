#!/bin/sh
# Creates the runtime and migrator roles (RFC-10 R7, RFC-41 R9).
set -eu
APP_PW="$(cat /run/secrets/db_app_password)"
MIG_PW="$(cat /run/secrets/db_migrator_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE treerepro_migrator LOGIN PASSWORD '${MIG_PW}';
CREATE ROLE treerepro_app LOGIN PASSWORD '${APP_PW}';
GRANT CREATE ON DATABASE ${POSTGRES_DB} TO treerepro_migrator;
GRANT CREATE, USAGE ON SCHEMA public TO treerepro_migrator;
GRANT USAGE ON SCHEMA public TO treerepro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE treerepro_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO treerepro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE treerepro_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO treerepro_app;
EOSQL

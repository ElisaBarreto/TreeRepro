#!/bin/sh
# Creates the runtime, migrator and backup roles (RFC-10 R7, RFC-10 R9, RFC-41 R9).
#
# Passwords never touch psql's argv (visible in /proc while the command runs)
# nor the SQL text the server receives (logged with the statement on error):
# `\password` reads the value from psql's stdin — this heredoc; the container
# has no controlling terminal, so the /dev/tty prompt falls back to stdin —
# computes the SCRAM-SHA-256 verifier client-side and sends only the verifier.
set -eu
APP_PW="$(cat /run/secrets/db_app_password)"
MIG_PW="$(cat /run/secrets/db_migrator_password)"
BKP_PW="$(cat /run/secrets/db_backup_password)"

psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE treerepro_migrator LOGIN;
\password treerepro_migrator
$MIG_PW
$MIG_PW
CREATE ROLE treerepro_app LOGIN;
\password treerepro_app
$APP_PW
$APP_PW
CREATE ROLE treerepro_backup LOGIN;
\password treerepro_backup
$BKP_PW
$BKP_PW
GRANT CREATE ON DATABASE ${POSTGRES_DB} TO treerepro_migrator;
GRANT CREATE, USAGE ON SCHEMA public TO treerepro_migrator;
GRANT USAGE ON SCHEMA public TO treerepro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE treerepro_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO treerepro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE treerepro_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO treerepro_app;
GRANT pg_read_all_data TO treerepro_backup;
EOSQL

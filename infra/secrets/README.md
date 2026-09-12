# Secrets

Files in this directory are mounted as Docker secrets (`/run/secrets/<name>`) and are gitignored.
Generate development values with `./scripts/gen-secrets.sh`. In production, generate them on the
server the same way and back them up outside the server.

| File | Used by | Format |
|---|---|---|
| `db_superuser_password` | postgres (bootstrap only) | any, hex recommended |
| `db_app_password` | postgres init, api | any, hex recommended |
| `db_migrator_password` | postgres init, migrate, backup | any, hex recommended |
| `redis_password` | redis, api | any, hex recommended |
| `pii_encryption_key_v1` | api | 64 hex characters (RFC-40 R3) |
| `pii_hmac_key` | api | 64 hex characters (RFC-40 R5) |
| `session_secret` | api | 64 hex characters |

Key rotation: RFC-40 R7. Postgres role passwords are set only on the first initialization of the
data volume (`docs/gotchas/postgres.md`).

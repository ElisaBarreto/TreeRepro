# Secrets

Files in this directory are mounted as Docker secrets (`/run/secrets/<name>`) and are gitignored.
Generate development values with `./scripts/gen-secrets.sh`. In production, generate them on the
server the same way and back them up outside the server.

| File | Used by | Format |
|---|---|---|
| `db_superuser_password` | postgres (bootstrap only) | any, hex recommended |
| `db_app_password` | postgres init, api | any, hex recommended |
| `db_migrator_password` | postgres init, migrate | any, hex recommended |
| `db_backup_password` | postgres init, backup (read-only role) | any, hex recommended |
| `redis_password` | redis, api | any, hex recommended |
| `pii_encryption_key_v1` | api | 64 hex characters (RFC-40 R3) |
| `pii_hmac_key` | api | 64 hex characters (RFC-40 R5) |
| `session_secret` | api | 64 hex characters |
| `smtp_password` | api | SMTP password, read only when `SMTP_USER` is set; may be empty otherwise |

## Permissions

Compose file secrets are bind mounts: each file appears inside the container with its **host**
owner and mode, and the services read it as uid 1000 (`node`), 999 (`redis`) or 70 (`postgres`).
Docker Desktop masks ownership; a Linux daemon does not. Compose's `uid`/`gid`/`mode` fields do
not help: they apply only to `environment:`/`content:` secrets, which Compose copies into the
container and refuses for `read_only` services (`pkg/compose/secrets.go`).

So the directory is the boundary and the files are readable by anyone who can reach them:

- `infra/secrets/` is `0700` (owner only).
- every secret file is `0444`.

`./scripts/gen-secrets.sh` sets both and re-applies them to existing files, so running it again
repairs the modes. Verify on a Linux host with
`docker compose exec api cat /run/secrets/session_secret >/dev/null`.

To write a value by hand (for example `smtp_password`), lift the read-only bit first and read
the value from a silent prompt so it never lands in the shell history:

```sh
read -r -s -p 'SMTP password: ' smtp_password; printf '\n'
chmod u+w infra/secrets/smtp_password
printf '%s' "$smtp_password" > infra/secrets/smtp_password
unset smtp_password
chmod 444 infra/secrets/smtp_password
```

## Rotation

Key rotation: RFC-40 R7. A new key version file (`pii_encryption_key_v<N+1>`) must also be added
to `compose.yml`, both under the top-level `secrets:` and in the `api` service's `secrets:` list,
or `loadKeyring` never sees it. Postgres role passwords are set only on the first initialization
of the data volume (`docs/gotchas/postgres.md`).

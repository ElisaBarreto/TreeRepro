# Plan 15a — Production gate for the PlantRepro migrations

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §8. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`.

The data in production is real. Before any PlantRepro migration merges (15c, 15d, 15f), its branch must be rehearsed on a restored copy of production, and the owner must give an explicit go. This plan writes that procedure and its checks. It does not touch the production database.

## Tasks

1. **Procedure.** Add a section “PlantRepro migrations: rehearsal and go” to `docs/gotchas/import.md` (or a new `docs/gotchas/platforms.md`). It has these steps:
   1. Download the latest off-site backup from R2 and decrypt it with the age identity.
   2. Restore it into a throwaway local Postgres. Use a separate Compose project, never the dev stack's volume.
   3. Run the **before** checks (below) and save the output.
   4. Run `migrate` from the branch under test against that database.
   5. Run the **after** checks and diff the two outputs. The only allowed differences are the new columns and their backfilled values.
   6. Post the diff on the plan's issue and wait for the owner's go before merging.
   7. Drop the throwaway database and delete the decrypted dump.
2. **Checks.** Write `scripts/rehearsal/checks.sql`, read-only:
   - counts of `users` (by status), `user_roles` (by role and, once the column exists, by platform), `species` (by `active`, `tree_flag`, and, once they exist, `plant_type` / `plant_type_status`), `records` (by origin), `annotations`, `contests`, `api_keys` (unrevoked), `audit_log`
   - **active users holding no role**, listed by id only, never by e-mail (spec §2). If the count is nonzero, the issue asks the owner what to do, per user, before 15c merges.
   - a checksum of the TreeRepro export columns: `md5(string_agg(...) order by id)` over the columns `records.csv` exports today
3. **Script.** Write `scripts/rehearsal/run.sh <branch-sha>`, which automates steps 2–5 and prints the diff. Its only inputs are the backup and the identity. Secrets are read from the local `.env` (R2_*) and `BACKUP_AGE_IDENTITY`, never echoed.
4. **Dry run.** Rehearse on the current `main` (no migration expected), so the before and after outputs are identical. Record in the issue that the backup restores.

**Done when:** the procedure is merged, a dry run on `main` produced an empty diff, and the restore was confirmed.

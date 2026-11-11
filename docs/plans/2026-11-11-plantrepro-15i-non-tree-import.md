# Plan 15i — Import the non-tree data (additive)

**Spec:** `docs/specs/2026-11-11-plantrepro.md` (non-goal of the platform work; this is the follow-up). **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`.

**Blocked until both conditions hold:** PlantRepro is live (15h), and the owner delivers the release that holds the non-tree observations.

## Tasks

1. **Decide the import mode with the owner.**
   - Today's modes are not additive for this case:
     - `--replace-imported` replaces every `EB_` record
     - `--trees-only` drops the non-tree rows
     - `--replace` is refused in production
   - Pick one of two options:
     - (a) the owner's next full release, imported with `--replace-imported` **without** `--trees-only`, so tree and non-tree rows come together and the platform records are kept and re-linked (RFC-64 R15)
     - (b) a new additive mode, which inserts only the species and records not already present
   - Write the decision into RFC-64.
2. **Rehearse.** Import the release on a restored copy of production, using the 15a procedure:
   - the tree data seen by TreeRepro is unchanged, by the 15a counts and checksum
   - the new species come in as `not_tree` / `reviewed`
3. **Import in production** with an explicit go. Then run `build:snapshot`.
4. **Verify** on both sites that TreeRepro is unchanged, and that PlantRepro shows the new species.

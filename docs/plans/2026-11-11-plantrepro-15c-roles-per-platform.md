# Plan 15c — Roles per platform

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §2. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`. **Gated:** run the 15a procedure on this branch, then wait for the owner's go before merging.

**After merge, TreeRepro users see nothing new**, apart from one change for admins: the user page shows a per-platform role section. Every current role is a TreeRepro role. Nobody holds a PlantRepro role yet, except admins, who hold both.

## Tasks

1. **RFCs.** Update the following:
   - RFC-31: roles assigned per platform; `admin` holds both; role definitions are shared; R7, R12, R13 and R15 apply per platform
   - RFC-32: effective permissions per `(user, platform)`; people-management permissions act account-wide
   - RFC-20: an invitation names its platform and roles
   - RFC-22: login on a platform with no role is refused
   - RFC-50: the user page shows a section per platform
2. **Migration** (next free number):
   - Add `user_roles.platform text not null default 'treerepro'` with a check over the platforms, then drop the default.
   - Primary key `(user_id, role_id, platform)`.
   - Insert a `plantrepro` row for every holder of `admin`.
   - Store admin as one row per platform. `setUserRoles` keeps the two rows in step and is the only writer.
3. **Permissions.**
   - `effectivePermissions(db, userId, platform)` and `resolvePermissions(…, platform)`.
   - The cache key and its generation include the platform. Invalidation on any role change bumps both platforms.
   - `requirePermission` reads `c.var.platform`.
   - Tests:
     - a contributor on TreeRepro only gets 403 on PlantRepro for `dataset.read`
     - an admin gets 200 on both
     - an API key of an admin works on both hosts
4. **`setUserRoles(userId, platform, roleIds)`.**
   - Granting or removing `admin` writes or removes both rows.
   - R7 (last admin) stays global. R12 (ceiling) is evaluated on the platform being assigned. R13 (self-change) applies.
   - The audit entry carries the platform.
   - Tests cover each rule per platform.
5. **Login refusal.** After a successful password and TOTP check, a user with no role on `c.var.platform` gets 403 `PLATFORM_ACCESS_DENIED`. No session is created, and `auth.platform_denied` is audited.
   - Covers password login and invitation acceptance. Password reset completion creates no session (RFC-22 R13), so it needs no check.
   - The SPA shows “You have no access to PlantRepro.” (or TreeRepro), naming the other platform when the user holds a role there.
6. **People management is account-wide.** `users.*`, `roles.manage`, `sessions.revoke`, `admin.access` and the audit routes list and act on every user, whatever their platform. Test: an admin on PlantRepro lists a user who holds only TreeRepro roles.
7. **Admin UI** (`/app/admin/users`, `/app/admin/users/$id`):
   - one role section per platform, with the other platform's section read-only when the actor cannot assign there
   - a Platform filter on the list
   - the invite form gains a platform choice and a role choice for it
8. **Invitations and mail.**
   - An invitation stores its platform.
   - The mail uses that platform's name and origin (`originOf`).
   - Acceptance on the other host is refused.
   - `seed:admin` takes `--platform` (default `treerepro`) and gives admin on both, since admin is global.
   - Jobs that mail (digest) state their platform explicitly.
9. **Rule 10:** update the admin routes' shape (platform in role payloads) in the route catalog, the guide, the changelog and the openapi hash.
10. **Rehearsal.** Run 15a on this branch, post the diff and the count of role-less users, and get the owner's decision and go.

**Verify:** the full suite plus E2E. Add an E2E case: a TreeRepro-only contributor is refused on `plantrepro.localhost` with the message from task 5.

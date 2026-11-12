# Plan 15h — PlantRepro go-live

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §8. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`. Every step on production needs an explicit go from the owner.

## Tasks

1. **Server.** Add `PLANT_DOMAIN=plantrepro.elisabarreto.com.br` to the production `.env` (`/srv/treerepro`, as `deploy`), then redeploy the current `main`.
2. **DNS.** Rafael creates the Cloudflare record for `plantrepro.elisabarreto.com.br`, proxied, as for TreeRepro. Confirm the TLS mode is Full (strict) for both hosts.
3. **Certificate.** Confirm that Caddy obtained the certificate for the new host. Check the Caddy logs, then run `curl -I https://plantrepro.elisabarreto.com.br/`.
4. **Smoke.** Check these on production:
   - the landing page shows the PlantRepro brand
   - an admin signs in on both hosts
   - a TreeRepro-only user is refused on PlantRepro
   - species counts on both sites match (no non-tree data yet)
   - `build:snapshot` has produced PlantRepro rows
5. **First access.** An admin grants PlantRepro roles to the people the owner names.
6. **Docs.** Update `docs/gotchas/infra.md` with the second host (DNS, certificate, `.env`). Update `README.md` with the two platforms.
7. **Close the epic.** Write the Outcome section on the epic, and remove `in-progress` from every closed issue.

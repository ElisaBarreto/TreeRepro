# Maps drawn by the platform (issue #293) Implementation Plan

**Spec:** `docs/specs/2026-10-23-platform-maps.md`. **Epic:** #286. Depends on #292 (snapshot tables).

1. RFC-76 rewritten.
2. Outlines: `scripts/maps/build-tdwg-outlines.R` → `apps/web/src/components/maps/tdwg-l3.json`.
3. Contracts: `MAP_KINDS`, the map entry, and the values query and response.
4. API:
   - `apps/api/src/maps/colour.ts` (the ramps and the Lab interpolation), unit-tested against R;
   - `apps/api/src/maps/regions.ts` (`listMaps`, `mapValues`);
   - the routes.
   Remove the manifest, check and visible modules, `MAPS_DIR` and `check:maps`.
5. Web: `api/maps.ts`, `RegionMap`, `MapFigure`, `MapViewer` and `MapsPage`; fixtures and tests.
6. E2E spec, compose, the Dockerfile and the e2e script.
7. Docs: the handbook (layout line, commands), `docs/gotchas/infra.md`, and the API guide, route catalog and openapi hash.
8. Verify, run CodeRabbit, open the PR (after #292 merges; rebase).

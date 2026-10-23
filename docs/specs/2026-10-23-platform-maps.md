# Maps drawn by the platform — Design

**Status:** approved by the owner, 2026-10-22 (epic #286 decision 5, issue #293). The rules are RFC-76, rewritten.

## Why

Release v1 no longer ships map images. The platform draws the maps from the weekly region snapshot (#292, RFC-78), with the owner's rules in `platform_package/R/platform_maps.R`. The private-maps machinery (`MAPS_DIR`, the manifest, `check:maps`, the three-`rsync` publish) goes away.

## Design

- **D1 Outlines in the web bundle** (RFC-76 R2). `scripts/maps/build-tdwg-outlines.R` turns the owner's TDWG level-3 GeoJSON into 148 KB of pre-projected Robinson SVG paths (368 regions), applying the owner's simplification rules. The file is committed as `apps/web/src/components/maps/tdwg-l3.json`. It is public geography (TDWG's WGSRPD, also in the owner's package), not data. So the browser needs no geo library and no projection code.
- **D2 Every rule in the API** (RFC-76 R3–R6, handbook rule 3). The API computes each region's value, the minimum species, the scale (0–100, or the data range with the log10 rule), and the fill colour. The colour is the CIELAB interpolation of `scales::gradient_n_pal` between the six viridisLite colours, which are hard-coded from R. A unit test pins the colours to R's own output. The web only paints.
- **D3 Routes.**
  - `GET /api/maps` keeps its role (which maps exist, now from the snapshot) and its envelope; an entry is `{ traitId, kind, levelId, regions, computedAt }`.
  - `GET /api/maps/values` gives the regions and the legend of one map.
  - `GET /api/maps/files/:name` is removed.
- **D4 Web.** The `/app/maps` explorer keeps its navigation. `MapFigure` draws a `RegionMap` (SVG paths with fill attributes, never style attributes, RFC-13 R5) and a legend (an SVG gradient). Each region has a `<title>` naming it, with its value and species count. The summary kinds are Mean, Median, SD, CV, Min and Max, explained over the species medians. The caption gives the snapshot date.
- **D5 Removed:**
  - `MAPS_DIR` and its mount (compose, Dockerfile, e2e script);
  - `apps/api/maps`;
  - the manifest, `check`, `visible` and their tests;
  - `check:maps`;
  - the private-maps runbook, and the handbook's publish procedure.

## Out of scope

The all-species view (#295) and downloading map images.

## Testing

- **API:**
  - the colour functions against R's colours (unit tests);
  - map listing (visibility, kinds per value type, minimum species, ordering) and values (completeness percentage, prevalence, the log rule, null below 3 species, 404 and 400) on an isolated database with a snapshot.
- **Web:** the map draws a path per region with the API's fill; the legend shows its ends; the page lists Median and CV; the caption gives the date.
- **E2E:** the maps spec is adapted to the computed maps.

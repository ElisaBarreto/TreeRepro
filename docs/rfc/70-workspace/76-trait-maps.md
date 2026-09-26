# RFC-76 — Trait maps

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

The project produces global maps outside the platform: for every trait, the share of species in each region with data for it (completeness); for a categorical trait, the prevalence of each level; for a quantitative trait, the mean, minimum, maximum and standard deviation. The platform does not compute them. It organises and displays image files that are committed to the repository and listed in a manifest, so the maps are versioned and reviewed like the code, and replacing one is a pull request (issue #197).

The maps are global aggregates, not a species' trait records, so a plot-restricted viewer sees them too (RFC-33's plot restriction is about trait records). They still sit behind login, which is why the API serves them rather than the static web root.

## Rules

- **R1** Maps are image files in `apps/api/maps/`, listed by `apps/api/maps/manifest.csv` with the header `trait_key,map_kind,level_key,file,data_version`. `map_kind` is one of `completeness`, `prevalence`, `mean`, `min`, `max`, `sd`. `level_key` is required for `prevalence` and empty for every other kind. `file` matches `^[a-z0-9][a-z0-9._-]*\.(svg|webp)$` and names a file present in the directory; no two rows name the same file. `data_version` is the date the map was generated, a real calendar date `YYYY-MM-DD`. No two rows share `(trait_key, map_kind, level_key)`. A manifest breaking any of these is rejected as a whole, naming the line.
- **R2** The committed manifest agrees with the trait dictionary (`apps/api/seed/trait-dictionary.csv`): every `trait_key` is a dictionary trait; `prevalence` rows belong to categorical traits and their `level_key` is one of that trait's levels; `mean`, `min`, `max`, `sd` rows belong to quantitative traits; `completeness` fits any trait. A test enforces it, so a pull request breaking it fails.
- **R3** Every map uses TDWG level 3 botanical countries (WGSRPD) as its regions and carries its legend inside the image; the platform draws no legend of its own. Prevalence maps of one trait share one colour scale, so its levels compare honestly — a property of the delivered images, not something the platform checks.
- **R4** `GET /api/maps` (`dataset.read`, resolves the viewer's `Visibility`) answers `{ data: MapEntry[] }`, `MapEntry` being `{ traitId, kind, levelId, file, dataVersion }` (`levelId` null except for `prevalence`). A manifest row is included only when its trait exists and is visible to the viewer (RFC-33: inactive only with `dataset.read_inactive`), its kind fits the trait's value type as in R2, and, for `prevalence`, its level exists on that trait and is visible. The plot restriction does not filter maps. Rows come in manifest order.
- **R5** `GET /api/maps/files/:name` (`dataset.read`, resolves `Visibility`) serves the bytes of the file named by an entry R4 would give this viewer, and answers 404 `MAP_NOT_FOUND` for any other name, so a name is never used as a path unless the manifest lists it. `Content-Type` is `image/svg+xml` for `.svg` and `image/webp` for `.webp`; `Cache-Control: private, no-cache`; the response carries an `ETag` and answers 304 to a matching `If-None-Match`, so a replaced file reaches the browser at the next view.
- **R6** Web: a **Maps** sidebar entry in the Data section, right after Traits (`dataset.read`, `map` icon). `/app/maps` shows a sticky bar of the dictionary categories that have maps, each an anchor `#<categoryKey>` to its section, in dictionary order; each section is a grid of cards, one per trait with maps, showing its completeness map as a thumbnail (its first map when it has no completeness map), its name and a Categorical / Quantitative badge, linking to `/app/maps/$traitId`. Traits without maps are left out; with no maps at all the page reads "No maps yet." Names, levels and categories come from the dictionary, never from the manifest.
- **R7** `/app/maps/$traitId`: breadcrumb `Data › Maps › <category> › <trait>`; the completeness map large at the top; for a categorical trait a grid of prevalence maps in dictionary level order, each labelled with its level; for a quantitative trait a 2 × 2 grid Mean / Min / Max / SD, missing kinds left out. Each map's caption reads `TDWG level 3 regions · <data_version>`. A map opens full size in a `<dialog>`. Images load lazily inside a fixed-ratio frame and carry an alt text naming kind, trait and level. The page links to the previous and next trait with maps in the same category and to **Trait details** (`/app/traits/$id`). A trait with no maps visible to the viewer reads "No maps for this trait."
- **R8** Trait-dictionary links: the trait page `/app/traits/$id` gains a **Maps** section after the distribution — the completeness map as a thumbnail and **See all maps for this trait →** — only when the trait has maps; the traits list shows a map link next to every trait with maps; on the species page, a trait card's help popover gains a **Maps** link when the trait has maps, and a trait with maps but no description still gets the popover for it. Which traits have maps comes from R4; the web never builds a file name.

## Open questions

None.

## Changelog

- 2026-09-26 — created and accepted (issue #197).

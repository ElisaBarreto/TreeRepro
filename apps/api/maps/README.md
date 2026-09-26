# Trait maps (RFC-76)

Each map is an image in this directory, listed on one line of `manifest.csv`:

    trait_key,map_kind,level_key,file,data_version
    flower_color,completeness,,flower_color-completeness.svg,2026-10-01
    flower_color,prevalence,red,flower_color-prevalence-red.svg,2026-10-01
    seed_dry_mass,mean,,seed_dry_mass-mean.svg,2026-10-01

- `trait_key` and `level_key` are the keys of `apps/api/seed/trait-dictionary.csv`.
- `map_kind`: `completeness` (any trait), `prevalence` (categorical, one row per level, `level_key` required), `mean`, `min`, `max`, `sd` (quantitative).
- `file`: lowercase letters, digits, `.`, `_`, `-`; ending `.svg` (preferred) or `.webp` (for a map too heavy as SVG, ~2000 px wide).
- `data_version`: the date the map was generated.
- Regions are TDWG level 3; the legend goes inside the image; prevalence maps of one trait share one colour scale.
- SVG: simplified geometry (target ≤ 300 KB), `viewBox` set, text as paths or a common sans font, no embedded raster, no scripts; colour-blind-safe palettes (viridis).
- To replace a map, overwrite the file under the same name and update its `data_version`. Changes go through a pull request; `pnpm test` checks the manifest against the dictionary.

# Trait maps (RFC-76)

The maps are private research output: this directory holds only this README
and a header-only `manifest.csv` in git. On the dev stack you may drop maps
here to try the page — `.gitignore` excludes every `.svg`/`.webp` under this
directory, so they never get committed. Production maps live in `/srv/maps`
on the server, mounted read-only into the API container as `MAPS_DIR`
(`docs/gotchas/infra.md` "Trait maps (private)").

Each map is an image, listed on one line of `manifest.csv`:

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

## Publishing

Publishing is copying files to the server and checking them, never a pull
request:

1. `rsync -av --delete Maps/Platform/ <server>:/srv/maps/` — copies the R
   pipeline's output (including `manifest.csv`) to the private directory.
2. `docker compose run --rm --no-deps api node dist/cli/check-maps.js` —
   validates the manifest against R1 and the trait dictionary in the
   database (RFC-76 R2); exits 1 and prints one line per problem if any row
   is wrong, 0 otherwise. It writes nothing.

No restart needed: the API reads the directory on every request.

To replace a map, overwrite the file under the same name and update its
`data_version`, then run `check:maps` again.

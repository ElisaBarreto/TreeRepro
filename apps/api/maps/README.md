# Trait maps (RFC-76)

The maps are private research output: this directory holds only this README
and a header-only `manifest.csv` in git — `.gitignore` excludes everything
else under it (`apps/api/maps/*`, with the README and `manifest.csv`
un-ignored), so a map dropped here never gets committed. Production maps live
in `/srv/maps` on the server, mounted read-only into the API container as
`MAPS_DIR` (`docs/gotchas/infra.md` "Trait maps (private)").

To try real maps on a laptop, do not copy them into this directory — the
publish pipeline's `manifest.csv` would overwrite the tracked header-only
one. Point the dev stack at a directory outside the repo instead:
`MAPS_HOST_DIR=<dir> docker compose up`.

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
request, and the check runs **before** the maps go live (RFC-76 R2 "Before
publishing"):

```sh
rsync -rtv --delete --chmod=D755,F644 Maps/Platform/ <server>:/srv/maps.next/
docker compose run --rm --no-deps -v /srv/maps.next:/maps-next:ro api node dist/cli/check-maps.js --dir /maps-next
rsync -rt --delete --chmod=D755,F644 /srv/maps.next/ /srv/maps/     # only after the check reports 0 problems
```

1. Stage the R pipeline's output (including `manifest.csv`) in a side-by-side
   directory, `/srv/maps.next`, never the live `/srv/maps`.
2. Validate the staged directory against R1 and the trait dictionary in the
   database (RFC-76 R2); exits 1 and prints one line per problem if any row
   is wrong, 0 otherwise. It writes nothing.
3. Only once that check reports 0 problems, sync the staged directory onto
   the live one.

No restart needed: the API reads the directory on every request. See
`docs/gotchas/infra.md` "Trait maps (private)" for why the last step is an
`rsync`, never an `mv`.

To replace a map, overwrite the file under the same name and update its
`data_version`, then run the same three steps again.

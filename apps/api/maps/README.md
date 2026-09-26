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
publishing"). The first command runs on the laptop; the other two run *on
the server*, logged in as an administrator with Docker access (not the CI
deploy key, which is forced to `scripts/deploy.sh` and can do nothing else —
`docs/gotchas/infra.md` "Deploy"); the server's own `.env` sets
`COMPOSE_FILE`, so a plain `docker compose` there already picks
`compose.prod.yml`:

```sh
rsync -rtv --delete --chmod=D755,F644 Maps/Platform/ <server>:/srv/maps.next/
ssh <admin>@<server> 'cd /srv/treerepro && docker compose run --rm --no-deps -v /srv/maps.next:/maps-next:ro api node dist/cli/check-maps.js --dir /maps-next'
ssh <admin>@<server> '
  rsync -rt --chmod=D755,F644 --exclude manifest.csv /srv/maps.next/ /srv/maps/
  rsync -rt --chmod=D755,F644 /srv/maps.next/manifest.csv /srv/maps/manifest.csv
  rsync -rt --delete --chmod=D755,F644 /srv/maps.next/ /srv/maps/     # only after the check reports 0 problems
'
```

1. From the laptop, stage the R pipeline's output (including `manifest.csv`)
   in a side-by-side directory on the server, `/srv/maps.next`, never the
   live `/srv/maps`.
2. On the server, validate the staged directory against R1 and the trait
   dictionary in the database (RFC-76 R2); exits 1 and prints one line per
   problem if any row is wrong, *and exits 1 (with `no manifest.csv in <dir>`
   on stderr) if the directory or its `manifest.csv` is missing* — a passing
   check must never wave an empty or mistargeted copy through to step 3 — 0
   otherwise. It writes nothing.
3. Only once that check reports 0 problems, publish onto the live directory
   in three steps, so `GET /api/maps` and `GET /api/maps/files/*` — which
   read `manifest.csv` and list the directory on every request — never see
   a manifest naming a file that isn't there yet (RFC-76 R1): first copy
   every new or changed image, without deleting anything and without
   `manifest.csv` itself, so the old manifest's files are all still present;
   then copy `manifest.csv` alone — `rsync` writes it to a temporary name
   in the destination and renames it into place, atomic on the same
   filesystem, so a concurrent read never sees a half-written file — the new
   manifest now names only files already copied in the first step; then a
   final synced copy with `--delete` removes whatever the new manifest no
   longer lists. An extra image present but not yet listed, between the
   first and second steps, is harmless (R1 never requires every file in the
   directory to be listed, only that every listed file exist).

No restart needed: the API reads the directory on every request. See
`docs/gotchas/infra.md` "Trait maps (private)" for why the last rsync of
step 3 is an `rsync`, never an `mv`.

To replace a map, overwrite the file under the same name and update its
`data_version`, then run the same three steps again.

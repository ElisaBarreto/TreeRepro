# Phylogenies: trait values at the tips of the tree

Status: design, awaiting owner approval (2026-11-14).

## Intent

The owner draws, in R, one phylogeny figure per trait. Each figure is a circular tree of the species with the trait's values at the tips, plus one figure of data coverage across all traits. Readers should be able to browse these figures next to the maps, and see a trait's phylogeny on that trait's own page beside its map. Seeing where a trait's states cluster on the tree is what the maps cannot show.

The figures change only when the owner makes a new data release and regenerates them. They do not need to follow contributions made on the platform between releases.

## Goals

1. A **Phylogenies** page under Data, right after Maps. Category tabs, then a button per trait that has a figure, the same as the Maps page (RFC-76 R7). The address remembers the choice (`/app/phylogenies?category=<key>&trait=<key>`).
2. The coverage figure shows when the page opens with no trait chosen. Choosing a trait shows that trait's figure.
3. Clicking a figure opens a full-screen viewer that zooms (wheel, pinch, + / − buttons) and pans (drag). Arrow keys move between the category's traits, as in the maps viewer. Zoom only needs to go "even a little bit" in: up to the figure's full resolution is enough.
4. On the trait page (`/app/traits/$id`), the Maps section (renamed **Maps and phylogeny** when it holds both) shows the trait's phylogeny beside the map thumbnail. It opens the same viewer and has a **See on Phylogenies →** link to `/app/phylogenies?trait=<key>`. Note: today that section's thumbnail is the completeness map (RFC-76 R8), not a prevalence map; the phylogeny goes beside whatever thumbnail is there.
5. On the species page, a trait card's help popover gains a **Phylogeny** link when the trait has a figure, next to the existing **Maps** link (RFC-76 R8). This is the builder's guess, accepted by the owner.
6. **PlantRepro** has the same page and the same spot on the trait page (rule 11, RFC-14 R2). Until the owner makes all-plant figures, both show the note "Phylogenies are not available on PlantRepro yet." When PlantRepro figures are published, they appear with no code change.
7. A TreeRepro trait without a figure shows no phylogeny on its page, and no button on the Phylogenies page. Nothing looks broken.

## Non-goals

- Generating the figures on the server. The server has 1 CPU and 3 GB of RAM, R is not in any image, and the figures only change with a release. The owner generates them locally.
- A download button. The maps offer one to admins (RFC-76 R11). Add it when someone asks.
- An interactive tree (clickable tips, search by species).

## Anti-goals

- The figures must never enter the public repository or be served to anyone not signed in. This is the same lesson as the earlier private maps (RFC-76 history, 2026-09-26).
- Pages must not load multi-megabyte PNGs to show a thumbnail or a page-width figure.

## Constraints and decisions

### Files

- The owner's files are named `trait_<key>.png`, where `<key>` is the trait's dictionary key (`traits.key`, the CSV's `standard_trait`). The coverage figure is `trait_coverage.png`. All 24 trait figures in the current draft match a dictionary key exactly.
- They are PNGs of 3600×2700 px (coverage 4200×3300 px) and 1.5–5.6 MB each. The owner is regenerating them with tighter crops and possibly larger sizes (about 6000 px wide).
- PNG stays the master format. SVG or PDF of thousands of tips would be huge and slow to draw.
- `coverage` is not a trait key today. The publish check must refuse a dictionary trait named `coverage` rather than confuse the two (builder: a one-line guard is enough).

### Storage and serving

This revives the private-files approach the maps used before 2026-10-23 (commit `4bc25ad7`, removed in `307738a3`), adapted:

- `PHYLOGENIES_DIR` (default `apps/api/phylogenies`, gitignored except a README), mounted read-only into `api` at `/phylogenies`, from `/srv/phylogenies` in production (`compose.prod.yml`).
- One subdirectory per platform: `treerepro/`, `plantrepro/`. A request reads only its own platform's directory (`c.var.platform`). A missing directory means no figures, not an error.
- Each figure has two files: the full PNG for the viewer, and a light display copy (about 1600 px wide, a few hundred KB) for page-width and thumbnail use. A JPEG at quality 80 of `trait_fruit_type.png` at 1600 px was 266 KB and readable. The format of the display copy is the builder's call (WebP, JPEG or a downscaled PNG). No new runtime dependency may be added only to make it.
- API, both `dataset.read` and both taking the viewer's `Visibility` (RFC-33 R10):
  - The plot restriction does not filter phylogenies (owner's decision, 2026-11-14): every viewer with `dataset.read` sees every figure of the platform, as with the maps (RFC-76 R5), even though a zoomed figure shows species' values at its tips. The RFC states this explicitly for the RFC-33 review.
  - A list route that answers which figures exist for the request's platform: the coverage figure, and each trait figure whose trait is visible to the viewer (inactive traits only with `dataset.read_inactive`).
  - A file route that streams one figure, display or full size, for a name the list would give that viewer, and answers 404 otherwise. It must never accept a path, only a trait key or `coverage`.
  - Builder's call: the route names and shapes, cache headers (the files change only on publish, so a long private cache with a version in the URL, such as the file's mtime, fits).
- Rule 10: the routes go into the route catalog and the API guide with a changelog entry.
- The production CSP already allows same-origin images.

### Publishing

- One command, run by the builder on the owner's request. It checks a folder of figures against the database's trait dictionary and lists unknown names and traits without a figure. It makes the display copies and copies everything to `/srv/phylogenies/<platform>/`, replacing what was there.
- The check runs against the database, as `check:maps` did (a CLI in `apps/api`, run in production with `docker compose run`). The copying is an `rsync` from this Mac, documented in `docs/gotchas/infra.md`, together with the display-copy step.
- Replacing figures for a new release is the same command.
- Order (builder's call, settled in the builder check): copy to a staging directory on the server (`/srv/phylogenies-staging/<platform>/`), run the check there against the production database, and only if it passes swap staging into `/srv/phylogenies/<platform>/`. Bad files never go live.
- The coverage figure is the owner's own drawing; the check does not look inside images. It is served to every viewer with `dataset.read` on that platform (builder's call).

### Web

- Sidebar entry **Phylogenies** in the Data section right after Maps (`dataset.read`). The icon is the builder's call.
- The page mirrors `/app/maps`: category tabs from the dictionary order, trait buttons, arrow-key movement, and a fallback to the default for an unknown key.
- Coverage (builder's call): the first tab, **All traits**, shows the coverage figure and is the default (`/app/phylogenies` with no parameters). The category tabs follow it. In the viewer, the arrow keys move within the shown tab only, so coverage is never mixed into a category's traits.
- The viewer: a dialog with the full PNG, zoom and pan, keyboard accessible (+, −, 0 to reset, arrows to change trait, Escape to close). It is built with CSS transforms; no zoom library is needed. It shows the display copy first and swaps in the full PNG once loaded.
- Empty state: when the platform has no figures at all, both the page and the trait page's spot show "Phylogenies are not available on {platform name} yet."

### Rules and process

- A new RFC, `docs/rfc/70-workspace/79-phylogenies.md`, holds the rules. RFC-76 R7 and R8 gain cross-references for the sidebar order, the trait page section and the popover link.
- `CLAUDE.md` gains the route under Layout and the publish command under Commands.
- Usual workflow: an issue (or an epic with an API and a web issue, the builder's call), RFC, failing tests, code, local CodeRabbit, merge when green.
- E2E: CI has no figures, so the E2E stack shows the empty state. Grep every spec that asserts the sidebar order or the trait page sections.

### The trait page section (builder's call)

RFC-76 R8 shows the Maps section only when the trait has maps. With this feature the section shows when the trait has a map or a figure; each half is shown only if it exists. On PlantRepro, while it has no figures, the note takes the figure's place beside the map, so it appears only on traits that have maps; a trait page with neither shows no section, as today.

## Left to the builder

- Route names and response shapes, cache headers, the display-copy format and tool.
- Whether thumbnails on the Phylogenies page are needed at all (the page shows one figure at a time) or only the display copy.
- The layout of "beside" on narrow screens (stacked below 768 px is fine).
- The sidebar icon.

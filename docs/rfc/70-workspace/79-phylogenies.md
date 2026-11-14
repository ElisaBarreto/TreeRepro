# RFC-79 — Phylogenies

| Field | Value |
|---|---|
| Status | accepted |
| Category | workspace |
| Supersedes | — |

## Context

The owner draws, in R, one phylogeny figure per trait (the species tree with the trait's values at its tips) and one figure of data coverage across all traits. The figures change only when the owner makes a new data release and regenerates them, so the platform displays delivered images; it does not draw them. Design: `docs/specs/2026-11-14-phylogenies.md` (issue #439).

The figures are not in the repository and sit behind login, like the private maps of 2026-09 (RFC-76 history).

## Rules

- **R1** Files. A platform's figures are in `<PHYLOGENIES_DIR>/<platform>/` (`treerepro`, `plantrepro`): `trait_<key>.png` per trait, `<key>` being the trait's dictionary key (`traits.key`), and `trait_coverage.png` for the coverage figure; each has a display copy `display/trait_<key>.jpg` (JPEG, longest side 1600 px). `PHYLOGENIES_DIR` defaults to `apps/api/phylogenies` (gitignored except its README) and is mounted read-only at `/phylogenies` from `/srv/phylogenies` in production. A missing directory means no figures.
- **R2** `GET /api/phylogenies` (`dataset.read`, resolves the viewer's `Visibility`) answers `{ data: [{ key, traitId, version }] }` for the request's platform: `coverage` (`traitId` null) when its PNG and display copy exist, then, by key, every trait visible to the viewer whose PNG and display copy exist. A PNG whose key is neither a trait nor `coverage`, or that has no display copy, is left out. `version` is the PNG's modification time in milliseconds, as a string.
- **R3** `GET /api/phylogenies/files/:key?size=display|full[&v=]` (`dataset.read`, resolves `Visibility`) answers the display copy (`image/jpeg`) or the PNG (`image/png`) of a figure R2 lists to this viewer, with `Cache-Control: private, max-age=31536000, immutable` (the web adds `v`, so a new figure is a new URL), and 404 `PHYLOGENY_NOT_FOUND` otherwise. `key` matches `^[a-z0-9_]+$` (400 `VALIDATION_FAILED` otherwise) and is looked up in R2's list, never joined into a path on its own.
- **R4** Visibility. An inactive trait's figure is listed and served only with `dataset.read_inactive` (RFC-33 R2). The plot restriction does not filter figures: every viewer with `dataset.read` sees every figure of the platform, as with the maps (RFC-76 R5), though a zoomed figure shows species' values at its tips (owner's decision, 2026-11-14). The coverage figure is the owner's drawing and is served to every viewer.
- **R5** `check:phylogenies --dir <platform dir>` checks a directory against the database's trait dictionary and prints: unknown names (a PNG whose key is neither a trait nor `coverage`), PNGs without a display copy, a trait whose key is `coverage`, and active traits without a figure. It exits 1 on any of the first three; traits without a figure are a report only.
- **R6** Web: a **Phylogenies** sidebar entry in the Data section right after Maps (`dataset.read`). `/app/phylogenies` shows a tab **All traits** (the coverage figure, the default), then one tab per dictionary category with figures, in dictionary order (`?category=<key>`); a category shows a button per trait with a figure (`?trait=<key>`; a trait alone selects its category; an unknown key falls back to **All traits**), the selected trait's name heading its figure. Tabs and buttons move with the arrow keys (RFC-76 R7). A figure is shown from its display copy; a click opens the full-size viewer: the PNG (the display copy until it loads, and kept if it fails), zoom 1× to 4× by ×1.5 steps with the wheel, pinch, **+** / **−** and **0** to reset, drag to pan while zoomed, Left/Right to the previous/next figure of the tab (wrapping, zoom reset), Escape to close. With no figures on the platform, the page shows "Phylogenies are not available on {platform} yet." (RFC-13 R14).
- **R7** Trait page and cards. The trait page `/app/traits/$id` section of RFC-76 R8 shows when the trait has maps or a figure: titled **Maps and phylogeny** with both, **Maps** or **Phylogeny** with one, the figure beside the map thumbnail (stacked below 768 px), opening R6's viewer, with **See on Phylogenies →** to `/app/phylogenies?trait=<key>`. When the platform has no figures at all, R6's sentence takes the figure's place beside the map. On the species page, a trait card's help popover gains a **Phylogeny** link to the same address when the trait has a figure (beside RFC-76 R8's **Maps**).
- **R8** Publishing. `scripts/phylogenies/publish.sh <source dir> <platform>` makes the display copies (`sips`, macOS), copies the files to `/srv/phylogenies-staging/<platform>/`, runs R5 there against the production database, and only if it passes replaces `/srv/phylogenies/<platform>/` with them. Procedure: `docs/gotchas/infra.md` "Phylogeny figures (private)".

## Open questions

None.

## Changelog

- 2026-11-14 — created and accepted (issue #439).

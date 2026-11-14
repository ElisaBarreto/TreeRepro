# Phylogeny figures (private)

The owner's phylogeny figures (RFC-79) are private research output: **never commit them**. Everything in this directory except this README is gitignored.

Layout, one subdirectory per platform:

```
treerepro/trait_<key>.png            full figure, <key> = the trait's dictionary key
treerepro/trait_coverage.png         coverage across all traits
treerepro/display/trait_<key>.jpg    display copy (JPEG, longest side 1600 px)
plantrepro/…                         the same for PlantRepro
```

In development the API reads this directory. Production mounts `/srv/phylogenies` at `/phylogenies` (`PHYLOGENIES_DIR`). Publish with `scripts/phylogenies/publish.sh`; see `docs/gotchas/infra.md` "Phylogeny figures (private)".

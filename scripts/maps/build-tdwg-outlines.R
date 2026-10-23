# Builds apps/web/src/components/maps/tdwg-l3.json, the TDWG level-3 outlines
# the maps are drawn on (RFC-76 R2), with the owner's rules
# (platform_package/R/platform_maps.R, read_region_outlines): Robinson
# projection, Antarctica left out, island parts under 1,000 km2 dropped (each
# region keeps its largest part), outlines simplified to 20 km.
#
#   Rscript scripts/maps/build-tdwg-outlines.R <tdwg_level3.geojson> <out.json>
#
# The input is the TDWG "World Geographical Scheme for Recording Plant
# Distributions" level 3 (github.com/tdwg/wgsrpd, geojson/level3.geojson), as
# shipped in the owner's platform_package/data. Needs sf and jsonlite.
suppressMessages({ library(sf); library(jsonlite) })
args <- commandArgs(TRUE)
if (length(args) != 2) stop("usage: build-tdwg-outlines.R <level3.geojson> <out.json>")
robinson <- "+proj=robin +lon_0=0 +datum=WGS84 +units=m +no_defs"
g <- st_make_valid(st_read(args[1], quiet = TRUE))
g <- suppressWarnings(st_wrap_dateline(g, options = c("WRAPDATELINE=YES", "DATELINEOFFSET=180")))
g$LEVEL3_COD <- as.character(g$LEVEL3_COD)
g <- st_transform(g[g$LEVEL3_COD != "ANT", "LEVEL3_COD"], robinson)
g <- suppressWarnings(st_collection_extract(g, "POLYGON"))
parts <- suppressWarnings(st_cast(g, "POLYGON"))
parts$area <- as.numeric(st_area(parts))
keep <- ave(parts$area, parts$LEVEL3_COD, FUN = function(a) a >= 1e9 | a == max(a)) == 1
parts <- st_simplify(parts[keep, ], preserveTopology = TRUE, dTolerance = 20000)
parts <- parts[!st_is_empty(parts), ]
# SVG units are kilometres, y pointing down.
ring_d <- function(m) {
  xy <- round(cbind(m[, 1] / 1000, -m[, 2] / 1000))
  xy <- xy[c(TRUE, rowSums(abs(diff(xy))) > 0), , drop = FALSE]
  if (nrow(xy) < 3) return("")
  paste0("M", xy[1, 1], " ", xy[1, 2], paste0("L", xy[-1, 1], " ", xy[-1, 2], collapse = ""), "Z")
}
paths <- tapply(seq_len(nrow(parts)), parts$LEVEL3_COD, function(i) {
  paste0(unlist(lapply(st_geometry(parts)[i], function(p) vapply(p, ring_d, ""))), collapse = "")
})
bb <- st_bbox(parts) / 1000
out <- list(
  viewBox = paste(floor(bb[["xmin"]]), floor(-bb[["ymax"]]), ceiling(bb[["xmax"]] - bb[["xmin"]]), ceiling(bb[["ymax"]] - bb[["ymin"]])),
  regions = as.list(paths[nzchar(paths)])
)
write(toJSON(out, auto_unbox = TRUE), args[2])
message(length(out$regions), " regions written to ", args[2])

# GEBCO bathymetry -> depth-contour PMTiles.
#
# Multi-resolution, no chunking: coarse isobaths are contoured on a downsampled
# grid, the dense fine set on the full-resolution grid, then merged, tagged and
# tiled. Everything that decides WHICH contours and HOW they're zoom-gated comes
# from config/levels.json via scripts/gebco_levels.py — this Makefile is plumbing.
#
#   make acquire        download the GEBCO global grid (one time, ~7.5 GB)
#   make                 build data/build/world.pmtiles from the global grid
#   make report          print PMTiles header + size
#   make smoke           fetch a small region and run the whole pipeline on it
#   make test            run the pure-Python unit tests
#   make clean           remove the build directory
#
# Override GRID / BUILD to run on a different source or output dir, e.g.
#   make GRID=data/build/smoke_src.tif BUILD=data/build/smoke

SHELL := /bin/bash
DIR := $(patsubst %/,%,$(dir $(realpath $(lastword $(MAKEFILE_LIST)))))
PY := python3 $(DIR)/scripts/gebco_levels.py
CFG := $(DIR)/config/levels.json

# --- config-derived values -------------------------------------------------
GRID        ?= $(DIR)/$(shell $(PY) get grid.path)
NCVAR       := $(shell $(PY) get grid.ncVariable)
COARSE_ARCSEC := $(shell $(PY) get build.coarseArcsec)
COARSE_DEG  := $(shell python3 -c "print($(COARSE_ARCSEC)/3600.0)")
MAXZOOM     := $(shell $(PY) get build.maxzoom)
SIMP        := $(shell $(PY) get build.simplification)
LAYER       := $(shell $(PY) get tippecanoe.layer)
NAME        := $(shell $(PY) get tippecanoe.name)
DESC        := $(shell $(PY) get tippecanoe.description)
ATTR        := $(shell $(PY) get tippecanoe.attribution)
COARSE_FL   := $(shell $(PY) fl --grid coarse)
FINE_FL     := $(shell $(PY) fl --grid fine)

BUILD       ?= $(DIR)/data/build
PMTILES     := $(BUILD)/world.pmtiles

# GDAL source connection string: NetCDF needs the subdataset/variable spec;
# a GeoTIFF is read directly.
ifeq ($(suffix $(GRID)),.nc)
SRC := NETCDF:"$(GRID)":$(NCVAR)
else
SRC := $(GRID)
endif

.PHONY: all acquire report test smoke clean summary
all: $(PMTILES)

acquire:
	bash $(DIR)/scripts/acquire.sh

summary:
	@$(PY) summary

$(BUILD):
	mkdir -p $@

# Source grid is an input, not something we build. Fail clearly if it's absent.
$(GRID):
	@echo "ERROR: source grid '$(GRID)' not found." >&2
	@echo "       Run 'make acquire' to download the GEBCO global grid, or pass" >&2
	@echo "       GRID=<path> (e.g. 'make smoke' for a small test region)." >&2
	@exit 1

# 1. Downsampled grid for the coarse isobath tiers (cheap; no visible loss
#    for widely-spaced lines). bilinear resample, written as a compressed,
#    tiled GeoTIFF in EPSG:4326.
$(BUILD)/coarse.tif: $(GRID) | $(BUILD)
	gdalwarp -overwrite -t_srs EPSG:4326 -tr $(COARSE_DEG) $(COARSE_DEG) \
	  -r bilinear -ot Int16 -co COMPRESS=DEFLATE -co TILED=YES $(SRC) $@

# 2a. Coarse contours (major/deep/shelf tiers) from the downsampled grid.
$(BUILD)/coarse.geojsonl: $(BUILD)/coarse.tif
	@rm -f $@
	gdal_contour -b 1 -a elev -f GeoJSONSeq -fl $(COARSE_FL) $< $@

# 2b. Fine contours (the dense 20 m set) from the FULL-resolution grid.
#     Passing only negative levels is the land mask: we never request a
#     positive elevation, so no contour is ever drawn over terrain.
$(BUILD)/fine.geojsonl: $(GRID) | $(BUILD)
	@rm -f $@
	gdal_contour -b 1 -a elev -f GeoJSONSeq -fl $(FINE_FL) $(SRC) $@

# 3. elevation -> {depth,rank,minzoom} lookup for the tagger.
$(BUILD)/elevmap.json: $(CFG) | $(BUILD)
	$(PY) map > $@

# 4. Merge both contour sets and tag each feature with depth/rank and a
#    per-feature tippecanoe.minzoom.
$(BUILD)/tagged.geojsonl: $(BUILD)/coarse.geojsonl $(BUILD)/fine.geojsonl $(BUILD)/elevmap.json
	cat $(BUILD)/coarse.geojsonl $(BUILD)/fine.geojsonl \
	  | python3 $(DIR)/scripts/tag_contours.py --map $(BUILD)/elevmap.json > $@

# 5. Tile to a single PMTiles file. Per-feature minzoom (set in step 4) makes
#    tippecanoe drop each contour below its rank's zoom. Attribution lands in
#    the PMTiles header metadata, the only durable place for it.
$(PMTILES): $(BUILD)/tagged.geojsonl
	tippecanoe -o $@ --force -P -l $(LAYER) -Z0 -z$(MAXZOOM) \
	  --simplification=$(SIMP) --drop-densest-as-needed --extend-zooms-if-still-dropping \
	  --name "$(NAME)" --description "$(DESC)" --attribution "$(ATTR)" \
	  $(BUILD)/tagged.geojsonl

report: $(PMTILES)
	@pmtiles show $(PMTILES)
	@echo; echo "PMTiles file: $(PMTILES)  ($$(du -h $(PMTILES) | cut -f1))"

test:
	python3 -m unittest discover -s $(DIR)/tests -v

smoke:
	bash $(DIR)/scripts/smoke.sh

clean:
	rm -rf $(BUILD)

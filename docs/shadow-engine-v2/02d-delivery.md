# 02d — Delivery, corridor size, and the agreement tail

Measured **2026-09-12 UTC**, `main` at `cbefb8a02ef136e83447754ec35acd9bd71f6d28`.
Settled inputs: [02](./02-architecture.md), [02a](./02a-feasibility.md),
[02b](./02b-placement.md), and [02c](./02c-lattice.md). Only this document and
[evidence/02d](./evidence/02d/) were added. No branch or `app/` change.

**z18 has a credible delivery path. It is the recommended implementation candidate,
but a certified production lattice remains blocked by source-wide bounds and device
residency/deadline qualification.** Fifty real-terrain, real-building, real-canopy tiles
compress to **23,516 B average / 66.88:1** with planar horizontal-delta gzip, versus
**34,945 B / 45.01:1** with the interleaved gzip method. These are full six-band bodies,
not the compressed size of a single height band or of the evidence logs.

For 02a's complete Madrid graph, the measured regional-bound corridor calculation
selects **50 / 99 / 232 z18 tiles** at **45° / 10° / 3°**, respectively. That is
**75 / 148.5 / 348 MiB** uncompressed per copy and an estimated
**1.254 / 2.483 / 5.818 MiB** of gzip bodies plus recipe metadata. Thus **40 reads
understates this graph's demand, while 20 MiB overstates these estimated transfers**.
The counts are exact outputs of the explicitly scoped planner below, **not certified
complete real-world working sets**: 02 §7's required unseen-source bounds do not exist
in these inputs. At 3°, 94 selected tiles extend beyond the captured building region.

The z18 severe tail is **eight readings, with two distinct mechanisms**: six readings
cross projected shadow boundaries through the fixed pixel lookup; two Kent readings
straddle the vector-footprint versus raster-occupancy boundary. Kent's invalid share
combines diagonal edges through buildings with offsets at the street edge. A guarded
street-width clamp lowers Kent invalidity **21.43% → 14.29%**, but raises its mean
disagreement **0.045 → 0.055**. No receiver, painter, or production-offset change is selected.

`[MEASURED]` identifies executed captures/compression/geometry; `[DERIVED]` identifies
byte arithmetic and wire estimates; `[LIMIT]` identifies missing qualification. Experiments
stopped once D1 and D2 had numbers; the remaining work was evidence analysis and verification.

## D1 — Actual z18 tile compression

### Inputs and composition

[MEASURED] Use every tile in a **5×5 z18 square around each fixture centre**:
Madrid `[-3.7038,40.4168]` and Kent `[-122.2348,47.3809]`, **25 tiles each**.
Selection precedes compression and includes all intervening tiles. These are spatially
adjacent observations in two areas, not 50 independent regional datasets.

Terrain was downloaded from the public
[AWS Terrain Tiles dataset](https://registry.opendata.aws/terrain-tiles/), at **z14**.
The preserved response headers identify **EUDEM `eudem_dem_5deg_n40w005.tif`** for Madrid;
Kent's headers identify **NED 1/3 arc-second `ned13/imgn48w123_13.tif`**. Exact source
names are retained in each response's `x-amz-meta-x-imagery-sources` header. Decode the provider's
[Terrarium format](https://github.com/tilezen/joerd/blob/master/docs/formats.md),
`R*256 + G + B/256 - 32768`, then bilinearly resample source pixel centres to canonical
ground vertices and quantize to 1/64 m. z14 delivery spacing is approximately
**7.274 m Madrid / 6.470 m Kent**; z18 spacing is **0.454650 / 0.404353 m**.
Resampling does not improve native DEM resolution. The provider documents mixed sources
and oversampling in its [source guide](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md).

The measured ground range is **657.938–687.000 m** across Madrid's tiles and
**11.594–14.578 m** across Kent's. **Every tile has nonconstant terrain**. No G=0
fixture is included in these statistics. The DEM's tile-specific vertical datum and
an EGM96 transform were not validated; these are compression witnesses on real elevations,
not qualified canonical production artifacts or a terrain-accuracy test.

Buildings use fresh Overpass closed ways: **5,658 Madrid / 518 Kent**, captured with
complete returned feature geometry. Madrid reproduces 02a's building count and 117 m
maximum normalized AGL. Retain its height priority and 10 m default. Normalize each
complete footprint's foundation using the median of terrain samples along its boundary
(at most one DEM delivery-pixel spacing apart), then make a flat absolute roof before
clipping to tiles. Rasterize cell-centre membership; higher roofs win, stable IDs break
ties. No roof falls below the sampled terrain in the 50 output tiles. This reproduces
the closed-way source limitation: relation holes, omitted buildings, and a production
building-part reconciliation are not certified.

Canopy is **actual Meta/WRI CHM**, fetched with the existing COG source/store, at its
fixed selected overview: **1.819 m Madrid / 1.617 m Kent**, not camera-dependent.
Preserve nearest-neighbour heights and validity; both windows are fully valid. Use
ground at cell centres, `C0 = G + 0.35h`, `C1 = G + h`, and 02's roof clipping.
The centre ground height comes from the fixed NW–SE terrain diagonal. Zero-height crowns
are absent. No trunks are introduced. Flags retain source-known/presence/inference states;
the provenance band indexes per-tile recipes containing building IDs/tags, ground recipe,
and canopy state. These are explicit probe bit assignments and recipe tables, not a
final production container specification. Source HTTP metadata preserves capture/revision
evidence separately. No random metadata was invented to simulate entropy.

[MEASURED] Building occupancy spans **11.50–67.03% Madrid / 3.02–48.84% Kent**.
The dense witness is Madrid `18/128376/98845`: **67.03% buildings**, nonconstant
664.95–671.19 m terrain. The sparse witness is Kent `18/42064/91793`:
**3.02% buildings and 40.97% canopy**, nonconstant 13.34–14.05 m terrain.
Sparse buildings therefore do not mean empty height/metadata bands.

### Layout and codec controls

Each body is exactly **6 × 256 × 256 × 4 = 1,572,864 bytes**, little endian:
`G, B, C0, C1, flagsAndMaterial, provenanceIndex`. No reduced height precision,
band omission, constant-band elision, byte shuffle, or lossy encoding is used.

Three layouts contain identical canonical integers:

1. **Interleaved:** the six values for a cell are adjacent, as in 02b's compositor.
2. **Planar:** every band's 65,536 values are contiguous, in row-major order.
3. **Planar + horizontal delta:** for each band and each row, retain its first value;
   subsequent values are `current - left`, modulo 2³². Reset at every row and band.
   Invert with row-wise prefix addition modulo 2³². Compress the concatenated six planes.

Test **gzip level 6**, matching 02b's default zlib level, **zstd level 3**, and
**Brotli quality 5**. All are installed. These levels are explicit controls, not equal
CPU-cost settings or an exhaustive codec optimization. Every layout/codec and every
individually compressed band was decoded and byte-compared. Encode/decode wall times are
retained as single observations; no production throughput or browser decode claim follows.

02b's **8,709 B** historical result was a different **z17, flat, sparse tile** and its
raw capture is lost. It is not a matched baseline to the new z18 tiles. The interleaved
column below is the valid comparison: **same new terrain-bearing integers, same gzip
level, different layout/predictor**. Do not interpret a comparison with 8,709 B as a
compression regression caused by planar layout.

### Tile results and spread

[MEASURED] Ratios are **uncompressed/compressed**, calculated from aggregate bytes,
not the mean of individual ratios. KiB = 1024 B. Body sizes exclude external recipe tables.

| Area | Encoding | Mean KiB | p50 KiB | p90 KiB | Min–max KiB | Aggregate ratio |
|---|---|---:|---:|---:|---:|---:|
| Madrid | Interleaved gzip 6 | 43.88 | 39.46 | 59.02 | 26.53–82.26 | 35.00:1 |
| Madrid | Planar gzip 6 | 31.35 | 28.28 | 39.93 | 19.09–56.42 | 49.00:1 |
| Madrid | Planar delta gzip 6 | 24.13 | 22.90 | 30.28 | 17.65–33.54 | 63.66:1 |
| Madrid | Planar delta zstd 3 | 27.17 | 25.58 | 35.77 | 18.77–39.43 | 56.53:1 |
| Madrid | Planar delta Brotli 5 | 19.22 | 18.36 | 24.34 | 13.65–29.06 | 79.90:1 |
| Kent | Interleaved gzip 6 | 24.37 | 24.39 | 30.90 | 8.11–34.89 | 63.03:1 |
| Kent | Planar gzip 6 | 21.19 | 21.11 | 28.19 | 7.24–33.38 | 72.50:1 |
| Kent | Planar delta gzip 6 | 21.80 | 21.84 | 28.18 | 6.93–33.21 | 70.46:1 |
| Kent | Planar delta zstd 3 | 22.59 | 22.16 | 29.36 | 4.84–35.89 | 67.98:1 |
| Kent | Planar delta Brotli 5 | 16.25 | 16.43 | 21.44 | 2.12–25.55 | 94.50:1 |

Over all 50 tiles, planar-delta gzip cuts interleaved gzip bytes by **32.70%**;
it is smaller on **50/50 tiles**. Madrid improves **45.01%**; Kent improves **10.54%**.
However, **delta is not universally beneficial**: Kent's plain-planar gzip is smaller
than its planar-delta gzip, and its interleaved Brotli is smaller than either planar
variant. Ground smoothness/quantization, building boundaries, CHM occupancy, and recipe
runs respond differently. This result supports recording the predictor in the format;
it does not justify claiming one predictor is optimal for all bands and tiles.

For the pooled sample, planar-only gzip averages **26,896.58 B (58.48:1)** versus
**23,516.14 B (66.88:1)** with delta. Planar-delta zstd averages **25,481.40 B
(61.73:1)**; Brotli averages **18,164.96 B (86.59:1)**. Gzip beats zstd at the tested
settings; Brotli gives the smallest pooled body. Across all layouts, Kent particularly
favours interleaved Brotli. No device/decoder decision is inferred from server codec size.

Recipe metadata is compressed separately and counted in D2: average gzip metadata is
**1,588.56 B Madrid / 878.92 B Kent**. The Madrid combined mean is **26,297.16 B gzip**,
**29,448.60 B zstd**, or **21,138.84 B Brotli** per tile. Regional bounds, HTTP headers,
container framing, gutters, and production evidence beyond this recipe remain additional.
The 25 Madrid gzip tile bodies are **all under 34,348 B**, well below 02c's conditional
128 KiB z18 allowance, without using the flat-tile result.

### Per-band ratios

Every uncompressed band is 262,144 B per tile. The following are aggregate ratios for
25 tiles per area, with **each band compressed independently**. Their compressed sizes
need not sum to the single-stream tile size: compression history can cross band boundaries.
The complete **900-row [per-tile, per-band, per-codec CSV](./evidence/02d/compression-per-band.csv)**
includes unpredicted and delta byte sizes and ratios. Thus neither band nor tile spread
is hidden by the aggregates.

| Area / band | Plain gzip ratio | Delta gzip ratio | Delta zstd ratio | Delta Brotli ratio |
|---|---:|---:|---:|---:|
| Madrid / G | 14.61:1 | 23.67:1 | 16.35:1 | 22.01:1 |
| Madrid / B | 97.47:1 | 80.39:1 | 88.77:1 | 113.47:1 |
| Madrid / C0 | 132.67:1 | 182.72:1 | 207.76:1 | 261.57:1 |
| Madrid / C1 | 122.35:1 | 183.47:1 | 211.60:1 | 263.28:1 |
| Madrid / flags | 105.31:1 | 93.58:1 | 81.98:1 | 156.16:1 |
| Madrid / provenance | 93.24:1 | 77.66:1 | 83.99:1 | 114.89:1 |
| Kent / G | 40.30:1 | 36.10:1 | 23.97:1 | 30.53:1 |
| Kent / B | 198.80:1 | 216.95:1 | 484.02:1 | 795.44:1 |
| Kent / C0 | 62.84:1 | 60.32:1 | 64.96:1 | 80.36:1 |
| Kent / C1 | 62.53:1 | 59.01:1 | 67.21:1 | 82.34:1 |
| Kent / flags | 122.10:1 | 121.57:1 | 125.42:1 | 346.84:1 |
| Kent / provenance | 126.82:1 | 130.71:1 | 148.32:1 | 346.70:1 |

All 50 individual tile results follow. Ratios use the 1.5 MiB body. Full layouts,
per-band observations, timing samples, and reconstructed-payload hashes are in
[compression-raw.json](./evidence/02d/compression-raw.json).

| Area / z18 x/y | Buildings / canopy | G range, m | Interleaved gzip B | Planar-delta gzip B (ratio) | zstd B (ratio) | Brotli B (ratio) |
|---|---:|---:|---:|---:|---:|---:|
| madrid 128372/98842 | 40.2% / 4.4% | 660.77–673.27 | 60,211 | 28,194 (55.8:1) | 31,199 (50.4:1) | 23,034 (68.3:1) |
| madrid 128373/98842 | 38.5% / 2.9% | 663.52–678.92 | 50,770 | 27,850 (56.5:1) | 33,001 (47.7:1) | 22,976 (68.5:1) |
| madrid 128374/98842 | 55.9% / 3.7% | 663.56–684.27 | 83,698 | 34,347 (45.8:1) | 40,380 (39.0:1) | 29,761 (52.8:1) |
| madrid 128375/98842 | 32.5% / 13.5% | 671.38–686.64 | 84,237 | 32,757 (48.0:1) | 36,955 (42.6:1) | 27,611 (57.0:1) |
| madrid 128376/98842 | 44.6% / 6.0% | 678.12–687.00 | 54,129 | 31,006 (50.7:1) | 34,172 (46.0:1) | 24,928 (63.1:1) |
| madrid 128372/98843 | 37.2% / 1.7% | 657.94–664.66 | 45,164 | 24,121 (65.2:1) | 26,262 (59.9:1) | 19,589 (80.3:1) |
| madrid 128373/98843 | 36.7% / 0.9% | 659.69–664.64 | 34,075 | 23,453 (67.1:1) | 25,311 (62.1:1) | 18,494 (85.0:1) |
| madrid 128374/98843 | 48.7% / 1.0% | 662.55–671.34 | 59,134 | 30,421 (51.7:1) | 36,633 (42.9:1) | 24,900 (63.2:1) |
| madrid 128375/98843 | 56.2% / 3.7% | 668.12–679.53 | 60,432 | 28,156 (55.9:1) | 31,338 (50.2:1) | 23,452 (67.1:1) |
| madrid 128376/98843 | 38.7% / 0.7% | 673.78–680.42 | 40,410 | 22,634 (69.5:1) | 24,280 (64.8:1) | 17,683 (88.9:1) |
| madrid 128372/98844 | 33.1% / 0.3% | 658.56–661.95 | 30,012 | 23,103 (68.1:1) | 26,051 (60.4:1) | 19,305 (81.5:1) |
| madrid 128373/98844 | 58.5% / 0.1% | 659.38–664.53 | 42,055 | 24,358 (64.6:1) | 28,434 (55.3:1) | 18,796 (83.7:1) |
| madrid 128374/98844 | 26.6% / 0.4% | 662.86–671.25 | 48,213 | 21,698 (72.5:1) | 24,669 (63.8:1) | 17,392 (90.4:1) |
| madrid 128375/98844 | 21.8% / 0.5% | 662.67–673.72 | 39,801 | 19,516 (80.6:1) | 22,306 (70.5:1) | 15,612 (100.7:1) |
| madrid 128376/98844 | 11.5% / 1.3% | 665.05–676.83 | 48,532 | 18,076 (87.0:1) | 19,219 (81.8:1) | 13,978 (112.5:1) |
| madrid 128372/98845 | 57.3% / 0.1% | 661.78–665.16 | 34,504 | 22,636 (69.5:1) | 26,191 (60.1:1) | 17,611 (89.3:1) |
| madrid 128373/98845 | 59.2% / 2.2% | 661.92–667.44 | 40,202 | 27,214 (57.8:1) | 30,970 (50.8:1) | 20,495 (76.7:1) |
| madrid 128374/98845 | 29.0% / 1.4% | 663.45–667.52 | 29,714 | 19,700 (79.8:1) | 19,920 (79.0:1) | 14,851 (105.9:1) |
| madrid 128375/98845 | 55.6% / 0.5% | 662.50–668.47 | 35,755 | 20,276 (77.6:1) | 22,245 (70.7:1) | 14,512 (108.4:1) |
| madrid 128376/98845 | 67.0% / 0.4% | 664.95–671.19 | 45,560 | 22,885 (68.7:1) | 24,639 (63.8:1) | 16,327 (96.3:1) |
| madrid 128372/98846 | 29.9% / 0.3% | 663.47–666.00 | 27,166 | 18,348 (85.7:1) | 21,296 (73.9:1) | 14,622 (107.6:1) |
| madrid 128373/98846 | 37.9% / 0.8% | 665.19–669.80 | 34,719 | 23,093 (68.1:1) | 25,548 (61.6:1) | 17,337 (90.7:1) |
| madrid 128374/98846 | 57.4% / 0.7% | 667.05–671.06 | 29,935 | 24,875 (63.2:1) | 28,761 (54.7:1) | 20,345 (77.3:1) |
| madrid 128375/98846 | 67.0% / 0.6% | 667.09–672.14 | 30,812 | 21,998 (71.5:1) | 26,022 (60.4:1) | 17,611 (89.3:1) |
| madrid 128376/98846 | 61.3% / 2.7% | 668.50–672.16 | 34,146 | 27,000 (58.3:1) | 29,840 (52.7:1) | 20,909 (75.2:1) |
| kent 42061/91792 | 23.6% / 10.7% | 11.59–12.14 | 22,336 | 19,970 (78.8:1) | 20,986 (74.9:1) | 14,816 (106.2:1) |
| kent 42062/91792 | 21.9% / 9.2% | 12.03–12.59 | 22,994 | 20,124 (78.2:1) | 21,313 (73.8:1) | 15,761 (99.8:1) |
| kent 42063/91792 | 26.2% / 17.1% | 12.47–13.34 | 27,797 | 24,634 (63.8:1) | 27,181 (57.9:1) | 19,246 (81.7:1) |
| kent 42064/91792 | 3.9% / 24.3% | 12.91–13.94 | 33,151 | 29,657 (53.0:1) | 32,832 (47.9:1) | 23,917 (65.8:1) |
| kent 42065/91792 | 23.2% / 8.8% | 13.58–14.56 | 23,832 | 20,216 (77.8:1) | 22,693 (69.3:1) | 15,463 (101.7:1) |
| kent 42061/91793 | 21.0% / 14.0% | 11.61–12.39 | 25,965 | 22,905 (68.7:1) | 23,958 (65.7:1) | 17,464 (90.1:1) |
| kent 42062/91793 | 43.2% / 5.8% | 12.08–12.91 | 22,765 | 19,727 (79.7:1) | 19,451 (80.9:1) | 14,556 (108.1:1) |
| kent 42063/91793 | 35.6% / 13.6% | 12.59–13.48 | 24,972 | 22,232 (70.7:1) | 22,269 (70.6:1) | 17,009 (92.5:1) |
| kent 42064/91793 | 3.0% / 41.0% | 13.34–14.05 | 35,726 | 34,007 (46.3:1) | 36,752 (42.8:1) | 26,167 (60.1:1) |
| kent 42065/91793 | 22.5% / 10.4% | 13.94–14.55 | 23,808 | 20,433 (77.0:1) | 21,684 (72.5:1) | 15,586 (100.9:1) |
| kent 42061/91794 | 24.5% / 11.6% | 11.72–12.50 | 25,103 | 22,985 (68.4:1) | 24,274 (64.8:1) | 17,107 (91.9:1) |
| kent 42062/91794 | 35.2% / 9.5% | 12.39–13.00 | 22,352 | 19,108 (82.3:1) | 19,202 (81.9:1) | 13,090 (120.2:1) |
| kent 42063/91794 | 22.5% / 18.8% | 12.89–13.52 | 24,798 | 22,386 (70.3:1) | 21,594 (72.8:1) | 15,655 (100.5:1) |
| kent 42064/91794 | 13.4% / 17.2% | 13.33–13.95 | 24,704 | 22,365 (70.3:1) | 21,928 (71.7:1) | 16,653 (94.4:1) |
| kent 42065/91794 | 20.1% / 11.3% | 13.83–14.58 | 25,522 | 22,359 (70.3:1) | 23,354 (67.3:1) | 16,821 (93.5:1) |
| kent 42061/91795 | 41.7% / 18.1% | 11.73–12.45 | 27,033 | 26,876 (58.5:1) | 27,218 (57.8:1) | 20,288 (77.5:1) |
| kent 42062/91795 | 48.8% / 16.5% | 12.30–12.95 | 25,816 | 24,368 (64.5:1) | 24,978 (63.0:1) | 18,151 (86.7:1) |
| kent 42063/91795 | 34.7% / 21.9% | 12.83–13.59 | 29,014 | 27,977 (56.2:1) | 28,159 (55.9:1) | 20,458 (76.9:1) |
| kent 42064/91795 | 29.5% / 4.5% | 13.34–14.00 | 20,979 | 17,747 (88.6:1) | 17,297 (90.9:1) | 12,878 (122.1:1) |
| kent 42065/91795 | 18.6% / 3.8% | 13.88–14.47 | 17,642 | 13,927 (112.9:1) | 14,171 (111.0:1) | 8,899 (176.7:1) |
| kent 42061/91796 | 20.7% / 21.3% | 11.67–12.48 | 30,688 | 28,859 (54.5:1) | 29,559 (53.2:1) | 21,934 (71.7:1) |
| kent 42062/91796 | 27.0% / 10.7% | 12.25–13.08 | 26,331 | 23,482 (67.0:1) | 25,142 (62.6:1) | 18,068 (87.1:1) |
| kent 42063/91796 | 16.7% / 25.8% | 12.88–13.66 | 31,644 | 28,326 (55.5:1) | 30,061 (52.3:1) | 21,951 (71.7:1) |
| kent 42064/91796 | 17.7% / 3.3% | 13.55–14.02 | 20,560 | 16,330 (96.3:1) | 17,419 (90.3:1) | 12,009 (131.0:1) |
| kent 42065/91796 | 23.7% / 0.3% | 13.88–13.98 | 8,307 | 7,092 (221.8:1) | 4,953 (317.6:1) | 2,170 (724.8:1) |

## D2 — Madrid corridor acquisition and working set

### Exact domain and scope of the numbers

[MEASURED] A fresh replay of 02a's query and the unchanged graph/snap/Dijkstra helpers
returns **260 ways, 820 nodes, 908 canonical edges, 7,314 inclusive sidewalk locations**,
and the same **280.6492639245 m / 20-node walk**. The selected walk has 19 edges and
152 sample locations. All coordinates and layouts are retained in
[route.json](./evidence/02d/route.json). This is 02a's explicitly smaller graph request;
02b's **4,039-edge production-padding graph is not measured here**.

Acquisition uses the **continuous strip between the two sidewalks along every edge**,
including full edges extending beyond the graph request bbox and disconnected components.
Sweep every strip toward **azimuth 135° clockwise from north**, exactly 02a's S2 direction,
then union the sweeps and enumerate intersecting globally anchored z18 tiles. This is
neither the viewport, the whole bounding rectangle, just the selected route, nor only
the tiles a warm opaque ray happened to visit. Buildings that terminate a warm ray do
not authorize shortening initial acquisition. Gutters do not count as extra requests
here: they are packaged with pages and their payload cost is shown separately.

Apply 02 §7's rule separately to terrain/building/canopy:

```text
reach_j = max(0, upperElevation_j - receiverLowerElevation) / tan(altitude)
required = union(receiver strips swept by each reach_j), plus spatial guard
```

The finite regional input bbox is `[-3.720,40.405,-3.690,40.427]` in
west/south/east/north order. Component upper elevations from this capture are
**688.421875 m terrain / 781.296875 m buildings / 699.390625 m canopy**.
Terrain uses a source-support scan, building tops use full-feature normalized roofs,
and canopy uses an additional **1399×1347** real CHM window over that region plus terrain.
The lowest sampled corridor terrain is rounded downward to **655.015625 m** for the
graph and **660.031250 m** for the selected walk. Dense continuous-boundary sampling
is used, not just the 25 m route sample schedule.

| Altitude | Graph terrain reach, m | Building reach, m | Canopy reach, m |
|---|---:|---:|---:|
| 45° | 33.406 | 126.281 | 44.375 |
| 10° | 189.456 | 716.177 | 251.663 |
| 3° | 637.429 | 2409.590 | 846.725 |

Buildings set the longest sweep in all three cases. The base run adds a **0.643 m
cell-diagonal guard**, uses the smallest receiver ground scale to avoid under-extending
the sweep in its local Mercator approximation, and takes the given altitude/azimuth as
exact. It assumes zero additional source horizontal error. A separately labelled
**10 m source-error sensitivity**, not an asserted provider accuracy, is also reported.
No sun is clamped. A production uncertainty wedge or all-direction fallback would need
its own declared angular bound.

**[LIMIT] These are reproducible planner counts under finite regional estimates,
not 02 §7.2's certified bound proof.** There is no source-wide conservative hierarchy,
validated vertical transform, exact terrain-minimum proof, or certified source/angular
error envelope. Even the two high-sun sweeps contained in the source region cannot rule
out an unseen taller/ridge caster outside it. At 3°, **94/232 graph tiles and 15/60
walk tiles are not wholly inside the captured building region**. We count them and mark
coverage unproved; we do not clip them away or pretend they were acquired. Hierarchy
pruning could remove some pages, while real external bounds/uncertainty could add others.
Consequently an exact, *complete production-required minimum* cannot be supplied from
these settled inputs. The table is the measured output of the stated corridor rule,
and the missing coverage proof remains a blocker rather than a fabricated maximum.

### Counts, memory, and estimated delivery

[MEASURED counts / DERIVED bytes] Cold, unique z18 tile bodies, one time/direction.
Wire estimates multiply tile count by **D1's Madrid mean for planar-delta bodies plus
compressed recipe metadata**, never the pooled lower Kent average or the old 8,709 B tile.
These are estimates, not network transfer observations for every corridor page.

| Domain | Altitude | Tiles | One copy, MiB | Worker + GPU with full gutters, MiB | Gzip wire MiB | zstd wire MiB | Brotli wire MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| graph | 45° | **50** | 75 | 152.35 | 1.254 | 1.404 | 1.008 |
| graph | 10° | **99** | 148.5 | 301.66 | 2.483 | 2.780 | 1.996 |
| graph | 3° | **232** | 348 | 706.92 | 5.818 | 6.516 | 4.677 |
| chosen-walk | 45° | **6** | 9 | 18.28 | 0.150 | 0.169 | 0.121 |
| chosen-walk | 10° | **20** | 30 | 60.94 | 0.502 | 0.562 | 0.403 |
| chosen-walk | 3° | **60** | 90 | 182.82 | 1.505 | 1.685 | 1.210 |

Receiver strips alone intersect **41 tiles for the graph / 4 for the walk**. Even
before any sunward caster acquisition, this graph exceeds 40 canonical reads.
The worker+GPU column assumes both own the whole admitted set; a smaller render
subscriber can require fewer GPU pages. It includes `258² × 24 B` per tile per copy,
but excludes hierarchy, source caches, metadata, staging, old/new generation overlap,
and driver memory. Those are payload estimates, not measured RSS or device peaks.

At **+10 m assumed horizontal error**, graph counts become **53 / 102 / 234**;
selected-walk counts become **7 / 21 / 61**. The corresponding graph gzip estimates
are **1.329 / 2.558 / 5.868 MiB**. This limited sensitivity does not replace a
provider's declared error or an angular sweep.

Using D1's **smallest–largest measured Madrid tile-body sizes**, graph gzip body-only
estimates span **0.862–1.638 / 1.707–3.243 / 3.999–7.599 MiB** at 45°/10°/3°.
These are observed-size scenario ranges, not statistical confidence intervals or upper
bounds on unseen tiles. Recipe metadata and other delivery overhead add bytes.

**Comparison with 02b's 40 reads / 20 MiB:**

- For this whole-graph cold calculation, reads are **1.25× / 2.475× / 5.8×** the
  assumption. The assumption is low at every tested altitude. For the already-selected
  walk alone, 40 reads is high at 45°/10° and low at 3°.
- Estimated whole-graph gzip transfer is only **6.27% / 12.41% / 29.09%** of 20 MiB.
  The assumed transfer envelope is generous for these measured ratios and scoped counts;
  read count and bytes were wrong in opposite directions. The old 512 KiB/read planning
  average is about **19.94×** the measured Madrid body-plus-metadata mean.
- 02b's allowance is **per session**, with two route calculations and two day jobs;
  these tables are **one cold calculation at one sun direction**, not an entire session.
  Repeating the same domain can reuse pages, while changing azimuth/day/view/route can
  add them. Do not multiply every job by the cold count or declare a session-wide pass
  without the union. Its four-million-read monthly scenario is therefore not validated.
- This is already **152.35 / 301.66 / 706.92 MiB** for worker+GPU including gutters
  when both mirror the graph set. Compression changes transfer, not resident integers.
  No mobile admission or 2500 ms readiness success follows from the small wire estimate.

Every selected key, per-component reach, byte calculation, guard variant, and out-of-region
count is retained in [corridor-raw.json](./evidence/02d/corridor-raw.json).

## D3 — Name the severe tail

[MEASURED] Replayed the 150 z18 fixtures with 02c's core and the unchanged painter,
inclusive pixel-sampling loop, blue predicate, and validity mask. **Every original
candidate and reference sidewalk value matches 02c exactly.** There are **8/300 severe
readings at z18**; the nine in 02c refer to z17/z19, not an unidentified ninth z18 case.
All IDs below are 02c's zero-based fixture IDs; each is a sidewalk reading, not a point.

| ID / side | City | UTC time | Sun altitude / north-clockwise azimuth | Edge bearing | Candidate / reference | Absolute difference |
|---|---|---|---:|---:|---:|---:|
| 28 L | Madrid | Dec 21 13:00 | 25.217° / 191.907° | 0° | 0.625 / 0 | 0.625 |
| 38 L | Madrid | Dec 21 13:00 | 25.217° / 191.908° | 0° | 0.625 / 0 | 0.625 |
| 45 L | Madrid | Jun 21 10:00 | 56.683° / 110.143° | 135° | 0 / 0.5 | 0.5 |
| 48 L | Madrid | Dec 21 13:00 | 25.217° / 191.907° | 135° | 0.5 / 1 | 0.5 |
| 84 R | Singapore | Sep 21 10:00 | 14.584° / 270.476° | 0° | 0.714286 / 0.428571 | 0.285714 |
| 135 R | Kent | Jun 21 18:00 | 54.610° / 121.026° | 0° | 0.75 / 0.25 | 0.5 |
| 138 R | Kent | Dec 21 20:00 | 19.161° / 178.225° | 0° | 1 / 0.5 | 0.5 |
| 144 R | Kent | Dec 21 22:00 | 14.773° / 206.604° | 45° | 1 / 0 | 1 |

**Mechanism A — correlated shadow-boundary pixel lookup displacement: six readings
(28, 38, 45, 48, 84, 144).** At all **18 mismatching valid points** in these readings,
the raster candidate agrees with vector shadow membership evaluated at the exact
receiver. The pixel reference agrees with that same vector geometry evaluated at the
pixel's painted centre. Thus no changed caster geometry is necessary to explain them.

The painter evaluates `(pixelIndex + 0.5) × 1.2 m`, while the sampler chooses
`round(projectedCoordinate)` with no compensating half-pixel shift. Relative to the
receiver, the selected painted location can move almost **1.2 m east and 1.2 m south**;
this is more than a symmetric ±0.6 m quantization interpretation. In the tail the observed
shift magnitude is **0.280–1.543 m** across both mechanisms. DPR 2 is already divided
out by this synthetic canvas's projector and multiplied back by the sampler; it does
not halve the painter's 1.2 m grid. This names the retained harness mechanism, not a
measurement of the actual renderer's physical-pixel resolution.

The nearby boundary is often a **shadow boundary, not a footprint boundary**:

| Readings | Mismatching points' distance to projected shadow boundary | Boundary vs route-edge acute angle | Distance to footprint |
|---|---:|---:|---:|
| 28 / 38 | 0.205 / 0.206 m | 0°: parallel | 9.00–9.96 m |
| 45 | 0.078 m | 45° | 4.832 m |
| 48 | 0.183 m | 56.91° | 4.832 m |
| 84 | 0.258 m | 89.52° | 8.536 m |
| 144 | 0.357 m | 45° | 5.895 m |

Madrid's parallel repeated block edges flip **five of eight** valid samples together.
Other cases involve diagonal or almost perpendicular boundaries; a parallel-street
explanation alone is insufficient. The diagonal Madrid cases have only **four valid
samples** on the affected sidewalk, so two flips yield 0.5 disagreement. Kent 144 has
only **two valid samples**, both flip, giving 1.0. Valid-only averaging amplifies a
small number of correlated pixel differences; it did not create a new physical blocker.

**Mechanism B — footprint/raster validity phase mismatch: two Kent readings (135, 138).**
Their four mismatching valid evaluations sit about **0.0045 m inside the vector footprint**,
but in a raster cell whose centre is outside it. The raster validity rule consequently
admits them; the ray hits the adjacent building. Both exact-point and painted-pixel
vector membership suppress ground shadow there as `onRoof`. This persists across a
54.61° summer sun and a 19.16° winter sun. It is a footprint-boundary convention and
lattice-phase issue, not low-sun reach or terrain, and not explained solely by pixel movement.

There is **no common low-sun cause**: the severe readings span 14.58–56.68°, several
edge orientations, and two geometrical mechanisms. The fixed synthetic regularity and
small valid denominators make the tail repeatable. No fix or gate rebaseline was performed.
Per-point values, validity, coordinates, RGB, painted centres, exact vector comparisons,
and boundary measurements are in [diagnostics-raw.json.gz](./evidence/02d/diagnostics-raw.json.gz)
and [tail-geometry.json](./evidence/02d/tail-geometry.json).

## D4 — Kent invalid samples and street-width clamp

[MEASURED / CODE] Kent's 21.4286% is **90/420 scheduled evaluations** across repeated
fixture times, including night. It is not 21.4% of real Kent sidewalks. The corpus uses
synthetic 18 m square buildings separated by 14 m streets, versus 60/20 m in Madrid
and 45/25 m in Singapore. All cities also include two diagonal edges through buildings.

Kent's exclusions divide exactly:

| Kent edge index | Geometry | Invalid / scheduled |
|---|---|---:|
| 0, 2, 4, 6 combined | Centred axis-aligned streets | 0 / 160 |
| 1, 3, 5 | Axis-aligned streets displaced 3 m toward the boundary | 30 / 120 |
| 7 | Other displaced street; different global raster phase | 0 / 40 |
| 8, 9 | Diagonals through the three building rows | 60 / 100 |
| Total | | 90 / 420 |

The 3 m displacement leaves **7 − 3 = 4 m** of nominal one-sided street clearance.
The 4 m helper uses **111195 m/degree**, whereas fixture construction uses **111320**;
its actual offset in the fixture frame is **4.0044966 m**. The near-side locations
therefore lie millimetres inside the nominal footprint. Global cell-centre phase admits
one displaced street's boundary samples and rejects the others. Kent's smaller block
pitch also gives fewer samples per axis edge, so a fixed number of excluded boundary
samples has more influence on its share. Madrid/Singapore have wider available street
clearance; their **140 / 140** exclusions are the diagonal geometry, not this 4 m squeeze.

Test two width-based variants at z18, keeping every fixture, time, sample count, caster,
painter pixel, and ceiling. Apply the **same changed receiver locations to both candidate
and reference**, retaining 02c's per-location mask and valid-only denominator. These are
explicit experimental receiver changes, not a replacement gate result for fixed ±4 m.

1. **Literal width clamp:** `min(4, streetWidth/2 - centrelineDisplacement)`.
   It changes **nothing**: Kent's limiting clearance is exactly 4 m, so the scale
   mismatch and boundary occupancy remain. All numbers equal the original run.
2. **Width clamp with lattice clearance:**
   `min(4, max(0, streetWidth/2 - displacement - halfCellDiagonal))`.
   Kent's limiting nominal offset becomes **3.7140795 m** (approximately 3.7183 m in
   the fixture frame), leaving room for raster-centre occupancy. Use the narrower
   side's clearance on both sidewalks to preserve paired offsets. Madrid/Singapore
   remain at 4 m. The diagonals have **no defined street-width corridor** in this
   synthetic corpus; leave their original locations and invalid evidence intact.
   Moving them around footprints would be a different graph-repair experiment.

| Metric | 02c ceiling | Fixed 4 m | Literal width clamp | Width clamp + half-diagonal clearance |
|---|---:|---:|---:|---:|
| Retained fixtures / sidewalk readings | 150 / 300 | 150 / 300 | 150 / 300 | 150 / 300 |
| Kent invalid share | ≤0.25 | 90/420 = 0.214286 | 0.214286 | **60/420 = 0.142857** |
| Overall invalid share | ≤0.25 | 370/2020 = 0.183168 | 0.183168 | **340/2020 = 0.168317** |
| Madrid invalid share | ≤0.25 | 0.162791 | 0.162791 | 0.162791 |
| Singapore invalid share | ≤0.25 | 0.189189 | 0.189189 | 0.189189 |
| Overall mean disagreement | ≤0.04 | 0.028810 | 0.028810 | **0.032143** |
| p90 | ≤0.05 | 0 | 0 | 0 |
| Severe share (>0.25) | ≤0.04 | 8/300 = 0.026667 | 0.026667 | **9/300 = 0.030000** |
| Madrid mean | ≤0.08 | 0.030000 | 0.030000 | 0.030000 |
| Singapore mean | ≤0.08 | 0.011429 | 0.011429 | 0.011429 |
| Kent mean | ≤0.08 | 0.045000 | 0.045000 | **0.055000** |
| Worst / zero-valid sidewalks | No worst ceiling | 1 / 0 | 1 / 0 | 1 / 0 |

**Answer: both corpus geometry and offset/boundary placement contribute.** The guarded
clamp eliminates the **30 boundary exclusions (one third of Kent's invalid evaluations)**,
leaving the **60 diagonal exclusions**. It improves validity and associated probe
confidence, but restores/relocates points that can differ from the fixed painted pixels;
agreement worsens while still meeting every listed numerical ceiling. This experiment
does not rerun CPU/GPU conformance or the canopy-background assertion variants for the
changed offsets. The original 02c contract and gate remain the settled production input.

## Production recommendation and stopping point

**Recommend z18 as the lattice to carry into implementation qualification; do not select
z19 on this evidence.** z18 is the least costly tested agreement pass, and its measured
compression removes the earlier *assumed* z18 transfer-budget objection for this scoped
Madrid graph. z19 still quadruples same-area resident cells and has no new measured
delivery/residency evidence here. z17 still fails 02c's p90 ceiling.

An unconditional production selection is still blocked by **certified unseen-caster
bounds and datum/error normalization**, and by **admitted worker/GPU/staging peaks plus
end-to-end 2500 ms acquisition on target devices**. The 3° graph's approximately
707 MiB worker/GPU payload illustrates why wire fit alone cannot resolve that choice.
The actual production-padded graph, session/day azimuth unions, production source recipe,
and rich evidence/container overhead also need sizing. These are identified blockers,
not permission to cap reach, silently drop coverage, alter the agreed receiver contract,
or turn this bounded measurement into a production pass.

## Reproduction and durable evidence

Use the repository's installed Node dependencies. Python used 3.12.8, NumPy 2.2.3,
Pillow, requests, zstandard 0.25.0, Brotli 1.0.9, and Shapely 2.1.2. Shapely was installed
only into `/tmp/umbra-02d-deps`, with no repository dependency edits. Exact versions and
platform are in [environment.json](./evidence/02d/environment.json). Installed Node is
20.20.1 on the same WSL2 i7-12700H machine as the earlier probes. No new browser/GPU
performance benchmark or cloud deployment ran.

```bash
python3 docs/shadow-engine-v2/evidence/02d/capture.py
node docs/shadow-engine-v2/evidence/02d/prepare.mjs
node docs/shadow-engine-v2/evidence/02d/diagnose.mjs
PYTHONPATH=/tmp/umbra-02d-deps python3 docs/shadow-engine-v2/evidence/02d/measure.py
PYTHONPATH=/tmp/umbra-02d-deps python3 docs/shadow-engine-v2/evidence/02d/summarize.py
python3 docs/shadow-engine-v2/evidence/02d/verify.py
```

Capture reuses existing durable source files; removing them requests new live inputs and
can change results. CHM requests are replayed from exact URL/range-keyed captures.
The initial Overpass GET returned 406; the POST capture succeeded. The failure log is
retained. An incidental Vite WebSocket port warning from overlapping local probes is
also retained; numerical execution completed. Run the reproduction commands sequentially.

Raw evidence includes original DEM PNGs and HTTP source/revision headers; losslessly
gzipped OSM responses; exact CHM range response blocks/headers and decoded height windows;
all 50 compressed planar-delta tile bodies and per-tile recipe tables; the complete graph,
tile-key lists, individual codec and per-band results; every diagnostic point for all
three offset variants; and scripts/logs. CHM blocks are **recorded ranges, not complete
COGs**. `gzip -dc` restores the raw JSON streams. Canonical tile integers restore by
gunzip followed by row-wise UInt32 prefix addition for each of the six bands; their
SHA-256 hashes were verified for **all 50 tiles**. All codec round trips also passed.
See [verification.log](./evidence/02d/verification.log),
[run-metadata.json](./evidence/02d/run-metadata.json), and
[SHA256SUMS](./evidence/02d/SHA256SUMS).

Attribution: **© OpenStreetMap contributors**, [ODbL](https://www.openstreetmap.org/copyright);
terrain via Mapzen/AWS with the providers' required
[terrain attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md);
CHM via the existing Meta/WRI source recipe and captured source.coop URLs. Original
02a/02b raw files are not claimed recovered. These new captures are durable evidence
for 02d, while 02c's original evidence is left untouched.

#!/usr/bin/env node
/**
 * Build the canopy acquisition-date index — A8a's answer to the metadata problem.
 *
 * The Meta/WRI canopy tiles carry their imagery acquisition dates in
 * `metadata/<quadkey>.geojson`, and reading one date the obvious way costs more
 * than reading the canopy: those files are 4.7 MB (Kent), 8.3 MB (Madrid) and
 * 24.4 MB (Singapore). Two measurements decide what to do about that, and both are
 * reproduced by `--report`:
 *
 * 1. **The dates are not the payload.** The `properties` of every feature in a
 *    tile sum to 105-781 bytes; the imagery footprint outlines are 99.997% of the
 *    file — 198k coordinate pairs for Madrid's four polygons, 586k for
 *    Singapore's thirty. Nothing is gained by fetching them at runtime.
 * 2. **They are not fetchable from a browser at any size.** `source.coop`
 *    republishes `chm/` only; `metadata/` 404s there, and Meta's own bucket sends
 *    no CORS headers. So unlike the COGs, this cannot be read browser-direct even
 *    if it were small.
 *
 * So the dates are resolved once, here, in Node — where neither size nor CORS
 * applies — and shipped as a coarse raster of date indices per tile. A z10 tile is
 * ~39 km of Web Mercator, so the default 128x128 grid is ~306 m per cell, and
 * run-length encoding collapses it to a few hundred bytes.
 *
 *   node scripts/canopy-acq-index.mjs            # rebuild the committed index
 *   node scripts/canopy-acq-index.mjs --report   # + the accuracy and size table
 *
 * Only the three A3 corpus tiles are indexed. Indexing the world is a
 * preprocessing pipeline and a decision for A8b/A8c, not something to start here.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rasterizeRings, tileMercatorBbox } from "./lib/mercatorRaster.mjs";

const META_BASE =
  "https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/metadata";

/** The A3 corpus centres, so this index describes the places A3 already measures. */
const CORPUS = [
  { city: "Madrid", quadkey: "0331110121" },
  { city: "Singapore", quadkey: "1322322311" },
  { city: "Kent, WA", quadkey: "0212300320" },
];

/**
 * Cells across a tile. 128 is ~306 m on a z10 tile, which `--report` measures at
 * well under 1% disagreement against exact point-in-polygon while staying small
 * enough to ship. Raising it costs bytes roughly linearly after RLE.
 */
const GRID = 128;

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "app",
  "lib",
  "canopyRaster",
  "acqDateIndex.json",
);

const report = process.argv.includes("--report");

const tiles = {};
const reportRows = [];

for (const { city, quadkey } of CORPUS) {
  const url = `${META_BASE}/${quadkey}.geojson`;
  process.stderr.write(`fetching ${city} ${quadkey}\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  const text = await response.text();
  const sourceBytes = Buffer.byteLength(text);
  const geojson = JSON.parse(text);

  const features = geojson.features
    .map((f) => ({
      date: f.properties.acq_date,
      rings: ringsOf(f.geometry),
    }))
    .filter((f) => f.date && f.rings.length > 0)
    // Latest acquisition last, so a later date wins where footprints overlap.
    // The mosaic does not say which source image a given pixel came from, so this
    // is a stated rule rather than a recovered fact — `--report` measures how
    // often it has to be applied.
    .sort((a, b) => a.date.localeCompare(b.date));

  const dates = [...new Set(features.map((f) => f.date))].sort();
  const tileBbox = tileMercatorBbox(quadkey);

  const cells = new Int16Array(GRID * GRID).fill(-1);
  const coverage = new Uint8Array(GRID * GRID);
  for (const feature of features) {
    const dateIndex = dates.indexOf(feature.date);
    rasterizeRings(feature.rings, tileBbox, GRID, GRID, (cell) => {
      cells[cell] = dateIndex;
      coverage[cell] = Math.min(255, coverage[cell] + 1);
    });
  }

  const runs = runLengthEncode(cells);
  tiles[quadkey] = { dates, runs };

  if (report) {
    const covered = coverage.reduce((n, c) => n + (c > 0 ? 1 : 0), 0);
    const overlapped = coverage.reduce((n, c) => n + (c > 1 ? 1 : 0), 0);
    reportRows.push({
      city,
      quadkey,
      sourceBytes,
      features: geojson.features.length,
      coordinatePairs: features.reduce(
        (n, f) => n + f.rings.reduce((m, r) => m + r.length, 0),
        0,
      ),
      dates: dates.length,
      indexBytes: Buffer.byteLength(JSON.stringify(tiles[quadkey])),
      runs: runs.length,
      // Dates present in the metadata but paintable on no cell: a footprint
      // smaller than one ~306 m cell vanishes from the grid, so the tile can
      // advertise a date that no lookup will ever return.
      datesResolvable: new Set(cells.filter((c) => c >= 0)).size,
      coveredPct: (covered / cells.length) * 100,
      overlapPct: covered === 0 ? 0 : (overlapped / covered) * 100,
      disagreementPct: measureDisagreement(features, dates, tileBbox, cells),
    });
  }
}

const index = {
  $comment:
    "Generated by scripts/canopy-acq-index.mjs. Imagery acquisition dates for the A3 corpus canopy tiles, rasterized so the browser never fetches the multi-megabyte source GeoJSONs.",
  source: `${META_BASE}/<quadkey>.geojson`,
  gridSize: GRID,
  tiles,
};
// Minified: this file is generated, never hand-edited, and pretty-printing the
// run arrays multiplies its size six-fold for no reader's benefit.
writeFileSync(outputPath, `${JSON.stringify(index)}\n`);
process.stderr.write(`wrote ${outputPath}\n`);

if (report) {
  const total = reportRows.reduce(
    (acc, r) => ({
      source: acc.source + r.sourceBytes,
      index: acc.index + r.indexBytes,
    }),
    { source: 0, index: 0 },
  );
  console.log(
    "\n| tile | source GeoJSON | polygons | coordinate pairs | distinct dates | resolvable | index | reduction | cells covered | overlapping | disagreement |",
  );
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of reportRows) {
    console.log(
      `| ${r.city} | ${(r.sourceBytes / 1e6).toFixed(2)} MB | ${r.features} | ${r.coordinatePairs.toLocaleString()} | ${r.dates} | ${r.datesResolvable} | ${r.indexBytes.toLocaleString()} B | **${Math.round(r.sourceBytes / r.indexBytes)}x** | ${r.coveredPct.toFixed(1)}% | ${r.overlapPct.toFixed(1)}% | ${r.disagreementPct.toFixed(2)}% |`,
    );
  }
  console.log(
    `\nAll three: ${(total.source / 1e6).toFixed(1)} MB of GeoJSON -> ${total.index.toLocaleString()} B of index (${Math.round(total.source / total.index)}x), grid ${GRID}x${GRID}.`,
  );
}

/** Every linear ring in a Polygon or MultiPolygon, as flat coordinate arrays. */
function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

/**
 * How often the shipped grid answers differently from a 4x finer rasterization.
 *
 * The index approximates a polygon boundary, so it is wrong in a band one cell
 * wide along every imagery seam. Comparing against the same scanline fill at 4x
 * the resolution samples the same points exact point-in-polygon would, but takes
 * one pass over the edges per row rather than per point — the exact form is
 * 262,144 points against Singapore's 586k vertices, which does not finish.
 *
 * This is the honest error figure to quote for a date read out of the index.
 */
function measureDisagreement(features, dates, tileBbox, cells) {
  const probe = GRID * 4;
  const fine = new Int16Array(probe * probe).fill(-1);
  for (const feature of features) {
    const dateIndex = dates.indexOf(feature.date);
    rasterizeRings(feature.rings, tileBbox, probe, probe, (cell) => {
      fine[cell] = dateIndex;
    });
  }

  const scale = probe / GRID;
  let wrong = 0;
  for (let row = 0; row < probe; row++) {
    for (let col = 0; col < probe; col++) {
      const coarse =
        cells[Math.floor(row / scale) * GRID + Math.floor(col / scale)];
      if (fine[row * probe + col] !== coarse) wrong++;
    }
  }
  return (wrong / fine.length) * 100;
}

/** `[[runLength, dateIndex], ...]`, where -1 is "no imagery footprint here". */
function runLengthEncode(cells) {
  const runs = [];
  let value = cells[0];
  let length = 0;
  for (const cell of cells) {
    if (cell === value) {
      length++;
    } else {
      runs.push([length, value]);
      value = cell;
      length = 1;
    }
  }
  runs.push([length, value]);
  return runs;
}

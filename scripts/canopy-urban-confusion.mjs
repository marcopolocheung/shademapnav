#!/usr/bin/env node
/**
 * A8c — does the canopy model read *buildings* as canopy? (#279)
 *
 * A8a established that the Meta/WRI v2 canopy height map is reachable: a
 * route-sized box is a few hundred kilobytes and a range read away from a page
 * with no server. Nothing in that result says it is *correct*, and the specific
 * way a global canopy-height model can be wrong in a city is that it reproduces
 * the thing cities are mostly made of. This script measures that, and the note it
 * feeds — `docs/notes/canopy-urban-confusion-2026-09-10.md` — records the verdict.
 *
 *   node scripts/canopy-urban-confusion.mjs                  # all four AOIs
 *   node scripts/canopy-urban-confusion.mjs --aoi madrid     # one
 *   node scripts/canopy-urban-confusion.mjs --json out.json  # + raw measures
 *
 * **It is a gate, not a step.** Nothing here reaches `ShadowField`, routing or the
 * renderer, and nothing should until the note says PASS or CONDITIONAL PASS.
 *
 * **Everything is cached on first read.** A8a hit 504s, truncated responses and a
 * 300 s timeout from `source.coop` after a few hundred requests, and public
 * Overpass failed two of three recon queries first try. Transient host failures
 * must not contaminate the science, and re-running the analysis must not re-hit
 * the network. Delete `node_modules/.cache/umbra-canopy/` to force a refetch.
 *
 * **Why it bundles the reader instead of reimplementing it.** The canopy raster is
 * read through `app/lib/canopyRaster/canopyCog.ts` — the same overview selection,
 * the same mask-IFD filter, the same pixel window the app uses — so this measures
 * the dataset as Umbra would actually see it. Those are TypeScript modules written
 * for the browser; `esbuild` (already installed, as Vite's own dependency) turns
 * them into something Node can import. It needs no browser and no Playwright.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mercatorX, mercatorY, rasterizeRings } from "./lib/mercatorRaster.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(REPO_ROOT, "node_modules", ".cache", "umbra-canopy");

/**
 * The four areas of interest.
 *
 * Three are the A3 corpus centres, so every number here is comparable with the
 * canopy census and the feasibility note. The fourth exists because the A3
 * Singapore coordinate is the *country centroid* and lands in reservoir and green
 * land — 45 buildings in 2 km², none with a height (#283). Swapping the pin
 * silently would break comparability with every published A3 number, so the pin
 * stays and Raffles Place is added beside it as the dense-urban stress case.
 */
const AOIS = [
  { slug: "madrid", label: "Madrid A3", lon: -3.7038, lat: 40.4168 },
  { slug: "kent", label: "Kent, WA A3", lon: -122.2348, lat: 47.3809 },
  { slug: "singapore", label: "Singapore A3", lon: 103.8198, lat: 1.3521 },
  { slug: "singapore-cbd", label: "Singapore CBD", lon: 103.851, lat: 1.284 },
];

/** Half-width of each AOI box, metres. 800 m is what the #283 building recon used. */
const DEFAULT_RADIUS_M = 800;

/** Canopy height thresholds, metres. Every share below is reported at all three. */
const THRESHOLDS = [2, 3, 5];

/** Dilations of the building mask, in ground metres. See "canopy retention". */
const DILATIONS_M = [1, 2];

/**
 * How far to slide the footprint mask for the falsification control, in metres.
 *
 * Clean building interiors are the result this gate is most likely to get wrong,
 * because a mis-registered or mis-projected footprint mask produces them for free.
 * A mask deliberately shifted off the buildings must come back looking like open
 * ground; if it does not, the alignment was never real and measure 1 means
 * nothing. 50 m is well past any plausible registration error and still inside the
 * AOI.
 */
const CONTROL_SHIFT_M = 50;

/** Upper edges of the CHM histogram bins, metres. The last bin is open. */
const HISTOGRAM_EDGES = [0, 2, 5, 10, 20];

/** Public Overpass 504s under load; two of three A8c recon queries failed first try. */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Building-height bins for the stratification, metres. `Infinity` closes the last. */
const HEIGHT_BINS = [0, 5, 10, 20, 30, 50, Infinity];

const args = process.argv.slice(2);
const radiusM = Number(argValue("--radius") ?? DEFAULT_RADIUS_M);
const only = argValue("--aoi");
const jsonPath = argValue("--json");

function argValue(flag) {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

const { readCanopyHeights, acquisitionAt, acquisitionDatesIn } = await loadAppModules();

const results = [];
for (const aoi of AOIS) {
  if (only && aoi.slug !== only) continue;
  process.stderr.write(`\n=== ${aoi.label} ===\n`);
  const raster = await canopyFor(aoi);
  const buildings = await buildingsFor(aoi);
  results.push(analyse(aoi, raster, buildings));
}

report(results);
if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`);
  process.stderr.write(`\nwrote ${jsonPath}\n`);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Bundle the two `app/lib/canopyRaster/` modules and import them.
 *
 * The output lands under `node_modules/.cache/` so that Node resolves `geotiff`
 * from the repo's own tree — a bundle written to a scratch directory outside the
 * project cannot see `node_modules` at all. `--packages=external` keeps `geotiff`
 * a real import rather than inlining a megabyte of decoder.
 */
async function loadAppModules() {
  mkdirSync(CACHE_DIR, { recursive: true });
  execFileSync(
    join(REPO_ROOT, "node_modules", ".bin", "esbuild"),
    [
      join(REPO_ROOT, "app", "lib", "canopyRaster", "canopyCog.ts"),
      join(REPO_ROOT, "app", "lib", "canopyRaster", "acqDate.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--packages=external",
      "--out-extension:.js=.mjs",
      `--outdir=${join(CACHE_DIR, "bundle")}`,
      "--log-level=warning",
    ],
    { cwd: REPO_ROOT },
  );
  const cog = await import(join(CACHE_DIR, "bundle", "canopyCog.mjs"));
  const acq = await import(join(CACHE_DIR, "bundle", "acqDate.mjs"));
  return {
    readCanopyHeights: cog.readCanopyHeights,
    acquisitionAt: acq.acquisitionAt,
    acquisitionDatesIn: acq.acquisitionDatesIn,
  };
}

/** `[west, south, east, north]` around a centre, in degrees. */
function bboxAround(lon, lat, metres) {
  const dLat = metres / 111320;
  const dLon = metres / Math.max(1e-6, 111320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** The decoded canopy raster for an AOI, from cache or from `source.coop`. */
async function canopyFor(aoi) {
  const stem = join(CACHE_DIR, `chm-${aoi.slug}-${radiusM}`);
  if (existsSync(`${stem}.json`) && existsSync(`${stem}.bin`)) {
    const meta = JSON.parse(readFileSync(`${stem}.json`, "utf8"));
    process.stderr.write(`canopy: cached ${meta.width}x${meta.height} @ ${meta.metresPerPixel.toFixed(2)} m/px\n`);
    return { ...meta, heights: new Uint8Array(readFileSync(`${stem}.bin`)) };
  }

  const aoiBbox = bboxAround(aoi.lon, aoi.lat, radiusM);
  process.stderr.write(`canopy: reading ${aoiBbox.map((v) => v.toFixed(4)).join(", ")}\n`);
  const { raster, stats } = await readCanopyHeights(aoiBbox);
  const meta = {
    width: raster.width,
    height: raster.height,
    bbox: raster.bbox,
    metresPerPixel: raster.metresPerPixel,
    overviewIndex: raster.overviewIndex,
    quadkey: raster.quadkey,
    payloadBytes: stats.payloadBytes,
    tilesRead: stats.tilesRead,
  };
  writeFileSync(`${stem}.json`, `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(`${stem}.bin`, Buffer.from(raster.heights));
  process.stderr.write(
    `canopy: ${meta.width}x${meta.height} @ ${meta.metresPerPixel.toFixed(2)} m/px, ` +
      `${(stats.payloadBytes / 1024).toFixed(0)} KB in ${(stats.totalMs / 1000).toFixed(1)} s\n`,
  );
  return { ...meta, heights: raster.heights };
}

/**
 * OSM building footprints for an AOI, from cache or from Overpass.
 *
 * `way["building"]` only, which is what the #283 recon counted — multipolygon
 * relations are a small minority of building geometry and adding them here would
 * make these counts incomparable with the numbers the handoff table quotes. The
 * omission is reported in the note rather than papered over.
 *
 * This is Node, so the `User-Agent` the OSMF policy requires can actually be sent;
 * that is the whole reason invariant 6 routes the browser through a proxy.
 */
async function buildingsFor(aoi) {
  const path = join(CACHE_DIR, `buildings-${aoi.slug}-${radiusM}.json`);
  if (existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8"));
    process.stderr.write(`buildings: cached ${cached.length}\n`);
    return cached;
  }

  const query =
    `[out:json][timeout:180];way["building"](around:${radiusM},${aoi.lat},${aoi.lon});out geom;`;
  const json = await overpass(query);
  const buildings = json.elements
    .filter((el) => el.type === "way" && Array.isArray(el.geometry))
    .map((el) => ({
      id: el.id,
      heightM: knownHeightM(el.tags),
      heightSource: heightSource(el.tags),
      lenientHeight: needsLenientParse(el.tags),
      rings: [closeRing(el.geometry.map((p) => [p.lon, p.lat]))],
    }))
    .filter((b) => b.rings[0].length >= 4);

  writeFileSync(path, `${JSON.stringify(buildings)}\n`);
  process.stderr.write(`buildings: ${buildings.length} fetched\n`);
  return buildings;
}

/** POST a query, rotating endpoints and backing off. */
async function overpass(query) {
  let lastError;
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length * 3; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      process.stderr.write(`buildings: POST ${endpoint}\n`);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Umbra/0.1 A8c canopy study (https://github.com/marcopolocheung/ShadeMapNavigation)",
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!response.ok) throw new Error(`${endpoint} -> ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      process.stderr.write(`buildings: ${error.message}; retrying\n`);
      await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * A building's height in metres, or `null` when OSM does not say.
 *
 * The precedence is `heightMForBuilding`'s (`app/lib/overpass.ts:288`) —
 * `render_height`, then `height`, then `building:levels` x 3 — with two
 * deliberate differences, both forced by what this study is:
 *
 * - **No 10 m default.** The app needs a number for every building; a
 *   stratification needs to know which buildings OSM actually measured. Filling
 *   2,400 unmeasured Madrid buildings with a constant would put a spike at 10 m in
 *   the middle of the very correlation being tested.
 * - **`parseFloat`, not `Number`.** `Number("12 m")` is `NaN`, so the app silently
 *   discards every unit-suffixed height OSM carries. Keeping them here is more
 *   data, not less rigour, and `--json` records how many needed the lenient parse.
 *   That the app drops them is a real finding about the app, not about the raster.
 */
function knownHeightM(tags) {
  const render = leadingMetres(tags?.render_height);
  if (render !== null) return render;
  const height = leadingMetres(tags?.height);
  if (height !== null) return height;
  const levels = leadingMetres(tags?.["building:levels"]);
  if (levels !== null) return levels * 3;
  return null;
}

/** Whether the app's strict `Number()` would have thrown this height away. */
function needsLenientParse(tags) {
  for (const key of ["render_height", "height", "building:levels"]) {
    const raw = tags?.[key];
    if (raw === undefined || raw === null) continue;
    if (leadingMetres(raw) === null) continue;
    return !(Number.isFinite(Number(raw)) && Number(raw) > 0);
  }
  return false;
}

function heightSource(tags) {
  if (leadingMetres(tags?.render_height) !== null) return "render_height";
  if (leadingMetres(tags?.height) !== null) return "height";
  if (leadingMetres(tags?.["building:levels"]) !== null) return "building:levels";
  return null;
}

/** A positive leading number, with a foot mark or `ft` converted to metres. */
function leadingMetres(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return /(^|[\d\s])(ft|')\s*$/.test(text) ? value * 0.3048 : value;
}

function closeRing(ring) {
  if (ring.length === 0) return ring;
  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  return firstLon === lastLon && firstLat === lastLat ? ring : [...ring, ring[0]];
}

// ---------------------------------------------------------------------------
// The measures
// ---------------------------------------------------------------------------

function analyse(aoi, raster, buildings) {
  const { heights, width, height: rows, metresPerPixel: mpp } = raster;
  const cells = width * rows;
  // The raster's own grid, in Mercator, so footprints are rasterized onto the
  // CHM's pixels and no canopy height is ever resampled.
  const [west, south, east, north] = raster.bbox;
  const gridBbox = [mercatorX(west), mercatorY(south), mercatorX(east), mercatorY(north)];

  const buildingMask = new Uint8Array(cells);
  const perBuilding = [];
  for (const building of buildings) {
    const chm = [];
    rasterizeRings(building.rings, gridBbox, width, rows, (cell) => {
      buildingMask[cell] = 1;
      chm.push(heights[cell]);
    });
    if (chm.length === 0) continue;
    perBuilding.push({
      id: building.id,
      heightM: building.heightM,
      heightSource: building.heightSource,
      pixels: chm.length,
      lenientHeight: building.lenientHeight,
      meanChm: chm.reduce((a, b) => a + b, 0) / chm.length,
      medianChm: quantile(chm, 0.5),
      p90Chm: quantile(chm, 0.9),
      maxChm: chm.reduce((max, v) => (v > max ? v : max), 0),
      shareOver: shareOverThresholds(chm),
    });
  }

  // Ground-metre distance from the nearest footprint pixel: 0 inside, and what
  // both the rings (measure 4) and the dilations (measure 5) are cut from. One
  // exact transform is cheaper and less arbitrary than four separate dilations.
  const distanceM = euclideanDistancePx(buildingMask, width, rows).map((px) => px * mpp);

  const insidePixels = countMask(buildingMask);
  const measures = {
    // 1 — how much of a building's own footprint the model calls canopy.
    footprintCanopyShare: fromThresholds((t) =>
      ratio(countWhere(heights, (v, i) => buildingMask[i] === 1 && v > t), insidePixels),
    ),
    // 2 — how much of what the model calls canopy is standing on a building.
    canopyInsideFootprintShare: fromThresholds((t) => {
      const total = countWhere(heights, (v) => v > t);
      return ratio(countWhere(heights, (v, i) => v > t && buildingMask[i] === 1), total);
    }),
    // 4 — contamination by distance outside the footprint, against a far baseline.
    // A ring hotter than the far baseline is leakage; a ring at the baseline is
    // just vegetation that happens to be near a building.
    rings: ringMeasures(heights, distanceM),
    // 5 — how much apparent canopy survives masking. A large drop at the exact
    // mask means the canopy was on buildings; a second large drop from +1 m means
    // building-edge leakage rather than vegetation.
    retention: retentionMeasures(heights, buildingMask, distanceM),
    // 3 — the smoking gun, if there is one.
    stratification: stratify(perBuilding),
  };

  // The control. A mask slid 50 m off the buildings should read like open ground.
  const shiftPx = Math.round(CONTROL_SHIFT_M / mpp);
  const shifted = shiftMask(buildingMask, width, rows, shiftPx);
  const shiftedPixels = countMask(shifted);
  measures.control = {
    shiftM: shiftPx * mpp,
    cells: shiftedPixels,
    canopyShare: fromThresholds((t) =>
      ratio(countWhere(heights, (v, i) => shifted[i] === 1 && v > t), shiftedPixels),
    ),
  };

  // Is a clean interior the model saying "no canopy", or the dataset saying
  // nothing at all? A8a does not read the 1-bit validity mask, so 0 could be
  // either. A spread of low non-zero values inside footprints is model output; a
  // wall of exact zeroes would be a nodata stamp and would void measure 1.
  measures.histogram = {
    inside: histogram(heights, (i) => buildingMask[i] === 1),
    outside: histogram(heights, (i) => buildingMask[i] === 0),
  };

  const known = perBuilding.filter((b) => b.heightM !== null);
  return {
    aoi: { ...aoi, radiusM },
    raster: {
      width,
      height: rows,
      metresPerPixel: mpp,
      overviewIndex: raster.overviewIndex,
      quadkey: raster.quadkey,
      payloadKB: raster.payloadBytes / 1024,
    },
    coverage: {
      buildings: buildings.length,
      buildingsWithPixels: perBuilding.length,
      buildingsWithKnownHeight: known.length,
      knownHeightShare: ratio(known.length, perBuilding.length),
      lenientlyParsedHeights: known.filter((b) => b.lenientHeight).length,
      footprintPixelShare: ratio(insidePixels, cells),
      canopyShare: fromThresholds((t) => ratio(countWhere(heights, (v) => v > t), cells)),
      maxChm: heights.reduce((max, v) => (v > max ? v : max), 0),
    },
    vintage: vintageFor(aoi, raster),
    measures,
    correlation: {
      spearman: spearman(
        known.map((b) => b.heightM),
        known.map((b) => b.meanChm),
      ),
      n: known.length,
    },
  };
}

function shareOverThresholds(values) {
  return fromThresholds((t) => ratio(values.filter((v) => v > t).length, values.length));
}

function fromThresholds(fn) {
  return Object.fromEntries(THRESHOLDS.map((t) => [t, fn(t)]));
}

function ringMeasures(heights, distanceM) {
  const bands = [
    { label: "inside", test: (d) => d === 0 },
    { label: "0-2 m out", test: (d) => d > 0 && d <= 2 },
    { label: "2-5 m out", test: (d) => d > 2 && d <= 5 },
    { label: ">5 m out", test: (d) => d > 5 },
  ];
  return bands.map((band) => {
    const cells = countWhere(distanceM, (d) => band.test(d));
    return {
      label: band.label,
      cells,
      share: fromThresholds((t) =>
        ratio(countWhere(heights, (v, i) => v > t && band.test(distanceM[i])), cells),
      ),
    };
  });
}

function retentionMeasures(heights, buildingMask, distanceM) {
  return fromThresholds((t) => {
    const total = countWhere(heights, (v) => v > t);
    const survives = (keep) => ratio(countWhere(heights, (v, i) => v > t && keep(i)), total);
    return {
      total,
      exact: survives((i) => buildingMask[i] === 0),
      ...Object.fromEntries(
        DILATIONS_M.map((m) => [`dilated${m}m`, survives((i) => distanceM[i] > m)]),
      ),
    };
  });
}

/**
 * CHM inside footprints, binned by the building's own OSM height.
 *
 * Per building, not per pixel: one 200 m tower has thousands of pixels and would
 * otherwise outvote a hundred houses. `medianOfMeans` is each building's mean CHM,
 * summarised across the bin.
 */
function stratify(perBuilding) {
  const known = perBuilding.filter((b) => b.heightM !== null);
  const bins = [];
  for (let i = 0; i + 1 < HEIGHT_BINS.length; i++) {
    const low = HEIGHT_BINS[i];
    const high = HEIGHT_BINS[i + 1];
    const members = known.filter((b) => b.heightM >= low && b.heightM < high);
    if (members.length === 0) continue;
    bins.push({
      label: high === Infinity ? `${low}+ m` : `${low}-${high} m`,
      buildings: members.length,
      medianBuildingHeight: quantile(members.map((b) => b.heightM), 0.5),
      medianOfMeans: quantile(members.map((b) => b.meanChm), 0.5),
      medianP90: quantile(members.map((b) => b.p90Chm), 0.5),
      shareOver: fromThresholds((t) =>
        // Pixel-weighted within the bin: the share of this bin's footprint area
        // the model calls canopy.
        ratio(
          members.reduce((n, b) => n + b.shareOver[t] * b.pixels, 0),
          members.reduce((n, b) => n + b.pixels, 0),
        ),
      ),
    });
  }
  return bins;
}

/** A copy of a mask translated `by` pixels east and south, dropping what falls out. */
function shiftMask(mask, width, height, by) {
  const out = new Uint8Array(mask.length);
  for (let row = 0; row + by < height; row++) {
    for (let col = 0; col + by < width; col++) {
      if (mask[row * width + col] === 1) out[(row + by) * width + col + by] = 1;
    }
  }
  return out;
}

/** Share of the selected cells in each CHM band. */
function histogram(heights, select) {
  const counts = new Array(HISTOGRAM_EDGES.length + 1).fill(0);
  let total = 0;
  for (let i = 0; i < heights.length; i++) {
    if (!select(i)) continue;
    total++;
    let bin = HISTOGRAM_EDGES.length;
    for (let b = 0; b < HISTOGRAM_EDGES.length; b++) {
      if (heights[i] <= HISTOGRAM_EDGES[b]) {
        bin = b;
        break;
      }
    }
    counts[bin]++;
  }
  return { total, shares: counts.map((c) => ratio(c, total)) };
}

/**
 * Imagery vintage over the AOI centre, and every date its tile carries.
 *
 * `acquisitionDatesIn` is the truth about the tile; `acquisitionAt` is what a
 * lookup at this point returns. They differ, and the gap matters: one tile is not
 * one date (Singapore's spans 2015-2019), so a per-AOI date is a claim about the
 * centre pixel, not about the box.
 */
function vintageFor(aoi, raster) {
  const at = acquisitionAt(aoi.lon, aoi.lat);
  const dates = acquisitionDatesIn(raster.quadkey);
  return {
    atCentre: at?.date ?? null,
    tileDates: dates.length,
    tileSpan: dates.length > 0 ? [dates[0], dates[dates.length - 1]] : null,
    // Northern-hemisphere leaf-off months. Reported, never applied: this study
    // does not correct for season, it says when the correction would be needed.
    leafOffRisk:
      at !== null && aoi.lat > 23.5 && [11, 12, 1, 2, 3].includes(Number(at.date.slice(5, 7))),
  };
}

// ---------------------------------------------------------------------------
// Numerics
// ---------------------------------------------------------------------------

function countMask(mask) {
  let n = 0;
  for (const v of mask) if (v === 1) n++;
  return n;
}

function countWhere(values, test) {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (test(values[i], i)) n++;
  return n;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** Spearman's rho — rank correlation, so a few 200 m towers cannot set the slope. */
function spearman(xs, ys) {
  if (xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const meanRank = (n - 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - meanRank;
    const b = ry[i] - meanRank;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

/** Zero-based ranks with ties averaged. */
function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const mean = (i + j) / 2;
    for (let k = i; k <= j; k++) out[order[k][1]] = mean;
    i = j + 1;
  }
  return out;
}

/**
 * Exact Euclidean distance in pixels from every cell to the nearest set cell.
 *
 * Felzenszwalb & Huttenlocher's separable transform: a 1-D lower envelope of
 * parabolas down the columns, then across the rows. Exact and linear, where a
 * chamfer approximation would quantise a 2 m ring into whatever the mask happened
 * to be shaped like — and the 2-5 m ring is precisely the measurement that
 * separates model error from registration error.
 */
function euclideanDistancePx(mask, width, height) {
  const INF = 1e20;
  const squared = new Float64Array(width * height);
  for (let i = 0; i < squared.length; i++) squared[i] = mask[i] === 1 ? 0 : INF;

  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) f[row] = squared[row * width + col];
    transform1d(f, d, v, z, height);
    for (let row = 0; row < height; row++) squared[row * width + col] = d[row];
  }
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) f[col] = squared[row * width + col];
    transform1d(f, d, v, z, width);
    for (let col = 0; col < width; col++) squared[row * width + col] = d[col];
  }

  const out = new Float64Array(squared.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(squared[i]);
  return out;
}

function transform1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

// Declarations, not arrow consts: `report` is called from the top of the file and
// would hit their temporal dead zone.
function pct(v) {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function num(v, digits = 1) {
  return v === null ? "—" : v.toFixed(digits);
}

function report(all) {
  const cols = all.map((r) => r.aoi.label);
  const row = (label, fn) => `| ${label} | ${all.map(fn).join(" | ")} |`;
  const header = `| | ${cols.join(" | ")} |\n|---|${cols.map(() => "---:").join("|")}|`;

  console.log(`\n## What was read\n\n${header}`);
  console.log(row("canopy tile", (r) => `\`${r.raster.quadkey}\``));
  console.log(row("pixels", (r) => `${r.raster.width}x${r.raster.height}`));
  console.log(row("ground resolution", (r) => `${num(r.raster.metresPerPixel, 2)} m/px`));
  console.log(row("overview level", (r) => r.raster.overviewIndex));
  console.log(row("compressed read", (r) => `${num(r.raster.payloadKB, 0)} KB`));
  console.log(row("buildings (`way`)", (r) => r.coverage.buildings.toLocaleString()));
  console.log(row("with a known height", (r) => `${pct(r.coverage.knownHeightShare)}`));
  console.log(row("footprint area", (r) => pct(r.coverage.footprintPixelShare)));
  console.log(row("CHM >2 m area", (r) => pct(r.coverage.canopyShare[2])));
  console.log(row("max CHM", (r) => `${r.coverage.maxChm} m`));

  console.log(`\n## 1. Share of building footprint the model calls canopy\n\n${header}`);
  for (const t of THRESHOLDS) {
    console.log(row(`>${t} m`, (r) => pct(r.measures.footprintCanopyShare[t])));
  }

  console.log(`\n## 2. Share of predicted canopy standing on a building\n\n${header}`);
  for (const t of THRESHOLDS) {
    console.log(row(`>${t} m`, (r) => pct(r.measures.canopyInsideFootprintShare[t])));
  }
  // Without this row the shares are uninterpretable: canopy scattered at random
  // over an AOI whose footprints cover 31% of it would land 31% of itself on a
  // building. The ratio is what says whether the model puts canopy on buildings
  // more or less often than chance.
  console.log(row("footprint share of AOI (chance)", (r) => pct(r.coverage.footprintPixelShare)));
  for (const t of THRESHOLDS) {
    console.log(
      row(`ratio to chance, >${t} m`, (r) =>
        num(
          ratio(r.measures.canopyInsideFootprintShare[t], r.coverage.footprintPixelShare),
          2,
        ),
      ),
    );
  }

  console.log("\n## 3. CHM inside footprints, by OSM building height\n");
  for (const r of all) {
    console.log(
      `\n**${r.aoi.label}** — Spearman rho(building height, mean interior CHM) = ` +
        `${num(r.correlation.spearman, 3)} over n=${r.correlation.n}\n`,
    );
    console.log(
      "| building height | buildings | median height | median of mean CHM | median p90 CHM | area >2 m | area >5 m |",
    );
    console.log("|---|---:|---:|---:|---:|---:|---:|");
    for (const bin of r.measures.stratification) {
      console.log(
        `| ${bin.label} | ${bin.buildings} | ${num(bin.medianBuildingHeight)} m | ` +
          `${num(bin.medianOfMeans, 2)} m | ${num(bin.medianP90, 1)} m | ` +
          `${pct(bin.shareOver[2])} | ${pct(bin.shareOver[5])} |`,
      );
    }
  }

  console.log("\n## 4. Contamination by distance from the nearest footprint\n");
  for (const r of all) {
    console.log(`\n**${r.aoi.label}**\n`);
    console.log("| band | cells | >2 m | >3 m | >5 m |");
    console.log("|---|---:|---:|---:|---:|");
    for (const band of r.measures.rings) {
      console.log(
        `| ${band.label} | ${band.cells.toLocaleString()} | ` +
          `${THRESHOLDS.map((t) => pct(band.share[t])).join(" | ")} |`,
      );
    }
  }

  console.log("\n### Control — the same mask, slid off the buildings\n");
  console.log(`\n${header}`);
  console.log(row("shift applied", (r) => `${num(r.measures.control.shiftM, 1)} m`));
  for (const t of THRESHOLDS) {
    console.log(row(`shifted mask, >${t} m`, (r) => pct(r.measures.control.canopyShare[t])));
    console.log(row(`real mask, >${t} m`, (r) => pct(r.measures.footprintCanopyShare[t])));
  }

  console.log("\n### CHM distribution inside vs outside footprints\n");
  const bands = HISTOGRAM_EDGES.map((edge, i) =>
    i === 0 ? "0 m" : `${HISTOGRAM_EDGES[i - 1] + 1}-${edge} m`,
  ).concat(`${HISTOGRAM_EDGES[HISTOGRAM_EDGES.length - 1] + 1}+ m`);
  console.log(`| AOI | where | ${bands.join(" | ")} |`);
  console.log(`|---|---|${bands.map(() => "---:").join("|")}|`);
  for (const r of all) {
    for (const where of ["inside", "outside"]) {
      const h = r.measures.histogram[where];
      console.log(`| ${r.aoi.label} | ${where} | ${h.shares.map(pct).join(" | ")} |`);
    }
  }

  console.log("\n## 5. Canopy retention under masking\n");
  console.log(
    `| AOI | threshold | canopy cells | survives exact mask | survives +1 m | survives +2 m |`,
  );
  console.log("|---|---|---:|---:|---:|---:|");
  for (const r of all) {
    for (const t of THRESHOLDS) {
      const m = r.measures.retention[t];
      console.log(
        `| ${r.aoi.label} | >${t} m | ${m.total.toLocaleString()} | ` +
          `${pct(m.exact)} | ${pct(m.dilated1m)} | ${pct(m.dilated2m)} |`,
      );
    }
  }

  console.log(
    `\nOne pixel is ${all.map((r) => num(r.raster.metresPerPixel, 2)).join(" / ")} m, ` +
      "so a +1 m dilation cannot select a different set of cells from the exact mask; " +
      "the +1 m column is reported for completeness and carries no information at this " +
      "resolution.",
  );

  console.log(`\n## 6. Imagery vintage\n\n${header}`);
  console.log(row("date at AOI centre", (r) => r.vintage.atCentre ?? "—"));
  console.log(
    row("dates in tile", (r) =>
      r.vintage.tileSpan ? `${r.vintage.tileDates} (${r.vintage.tileSpan.join(" … ")})` : "—",
    ),
  );
  console.log(row("leaf-off risk", (r) => (r.vintage.leafOffRisk ? "**yes**" : "no")));
}

/**
 * A spatial index over prism shadows (Track A, issue #122).
 *
 * `pointInPrismShadow` rebuilt every prism's shadow polygon for every query point:
 * two earcuts and ~36 coordinate tuples per prism per point, discarded immediately.
 * Five queries could afford that. Sampling a route graph — on the order of 100k
 * points against a couple of thousand buildings — could not.
 *
 * This module does the same geometry once per (prism set, sun, projection) and
 * buckets it into a uniform grid, so a query tests a handful of candidates rather
 * than the whole city. The answer is unchanged, and deliberately so: it calls the
 * same `buildShadowTriangles`, keeps footprint exclusion as a *complete* first pass,
 * and holds vertices as float64 so nothing is rounded on the way in.
 *
 * This module is pure — no map, no WebGL, no network — like `geometry.ts` beneath it.
 *
 * **Casters are prepared once and reused across sun positions (A6).** A prism's ring,
 * its bounds and its footprint bucket do not depend on where the sun is; only the
 * translation that turns the footprint into a shadow does. `prepareShadowCasters`
 * does the time-independent half once, so a time sweep pays for it once rather than
 * once per hour per sun cell. `buildShadowIndex` still takes raw prisms and behaves
 * exactly as it always did — it prepares them itself.
 *
 * **One documented divergence.** A point outside the indexed area answers `false`
 * without testing anything. The per-query path could answer `true` there, but only
 * from a zero-area triangle: at a near-horizon sun the shadow's side walls collapse
 * to a single longitude, and `pointInTriangle`'s absolute `|denom| < 1e-20` guard
 * stops catching that once the latitude span reaches ~0.09°, so it reports a point
 * hundreds of metres outside the triangle's own bounds as inside it. Inside the grid
 * the two agree exactly, degenerate slivers included, because the same predicate runs
 * over the same triangles. See #163.
 */

import earcut from "earcut";
import { type BuildingPrism, pointInTriangleXY } from "./geometry";

/**
 * The area the caller promises to stay inside.
 *
 * Structurally the same shape as `ShadeField`'s `BBox`, and declared here rather
 * than imported on purpose: `ShadeField` imports this module, and the dependency
 * must not run back the other way.
 */
export interface IndexRegion {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ShadowIndex {
  /** Exactly `pointInPrismShadow`'s answer, for the projection this index was built with. */
  isShaded(lng: number, lat: number): boolean;
  /** Prisms that survived the region filter and were triangulated. Diagnostics and tests. */
  readonly prismCount: number;
}

/** No cell finer than this, so a dense block of small buildings cannot explode `nx·ny`. */
const MIN_CELL_M = 20;

/** No cell coarser than this, or a high sun's short shadows stop bucketing usefully. */
const MAX_CELL_M = 400;

/**
 * Cells allowed per surviving prism before the grid is coarsened.
 *
 * Tying the budget to the data rather than to a constant is what keeps a
 * single-query build (the `pointInPrismShadow` wrapper, `region = null`) from
 * allocating a five-figure cell array to answer one question.
 */
const CELLS_PER_PRISM = 16;

/** Absolute ceiling on cells, whatever the prism count says. */
const MAX_CELLS = 1e6;

/** Nothing casts a shadow here, so nothing is shaded. Shared — it holds no state. */
const EMPTY_INDEX: ShadowIndex = {
  isShaded: () => false,
  prismCount: 0,
};

/** One prism that cleared phases 1 and 2, with the shadow bounds that got it there. */
interface Candidate {
  caster: Caster;
  /** The shift phase 1 already computed; phase 3 reuses it rather than redoing it. */
  dLng: number;
  dLat: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

/** One prism that can cast at all, with everything about it no sun position changes. */
interface Caster {
  /**
   * The ring flattened to `x, y` pairs, exactly as delivered — closing vertex and all.
   *
   * Flat because both hot loops read it per query: `pointInPolygonFlat` walks the
   * whole thing and the shadow emission walks its open prefix. An array of tuples
   * costs a pointer chase per vertex in the middle of a route-graph sample.
   */
  flat: Float64Array;
  /** Vertices in the *open* ring — `flat`'s prefix, without a duplicated close. */
  openCount: number;
  /**
   * `earcut` over the open ring — the near cap never moves, so it is cut once.
   *
   * Cut lazily, and that is the point: preparing a city means flattening every
   * prism, but a route's region filter typically keeps a few percent of them.
   * Earcutting all of them up front would make `sampleEdges` pay for geometry it
   * is about to discard, which is a cost the per-sun path never had.
   */
  capIndices: number[] | null;
  heightM: number;
  /** Bounds of the ring itself — the shadow's bounds before the sun shifts it. */
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * A uniform grid over *footprint* bounds, so a small region need not scan every prism.
 *
 * Distinct from the shadow grid `buildShadowIndex` builds per sun: that one buckets
 * shadows and is rebuilt whenever the sun moves, this one buckets the buildings and
 * never changes. See `castersNear` for why a footprint bucket is enough to find every
 * shadow that could reach an area.
 */
interface FootprintGrid {
  west: number;
  south: number;
  cellLng: number;
  cellLat: number;
  nx: number;
  ny: number;
  cells: Array<number[] | undefined>;
}

/** Prisms with the sun-independent half of their geometry already computed. */
export interface ShadowCasters {
  /** Prisms that can cast at all: a ring of ≥3 vertices with finite bounds. */
  readonly casters: Caster[];
  /** Largest `|heightM|`, which bounds how far any of them can throw a shadow. */
  readonly maxAbsHeightM: number;
  /** `null` below `GRID_MIN_CASTERS`, where a full scan is cheaper than a lookup. */
  readonly grid: FootprintGrid | null;
}

/** Below this a full scan beats a grid lookup, so `prepareShadowCasters` builds none. */
const GRID_MIN_CASTERS = 64;

/** Casters a footprint cell should hold on average — the grid is sized from this. */
const CASTERS_PER_FOOTPRINT_CELL = 4;

/** Ceiling on the footprint grid's side, so a sparse city cannot allocate a huge array. */
const MAX_FOOTPRINT_GRID_SIDE = 256;

/**
 * Do the half of the work that no sun position changes, once (A6).
 *
 * A prism's ring, its bounds and which footprint bucket it lands in are the same at
 * every hour; only the translation from footprint to shadow moves. Preparing them
 * once is what makes `sweep` cost far less than N separate samples — the per-sun
 * pass that remains is a handful of arithmetic per prism plus the triangulation of
 * whatever survives the region filter.
 */
export function prepareShadowCasters(prisms: BuildingPrism[]): ShadowCasters {
  const casters: Caster[] = [];
  let maxAbsHeightM = 0;

  for (const prism of prisms) {
    const ring = prism.ring;
    if (ring.length < 3) continue;

    let rw = Number.POSITIVE_INFINITY;
    let rs = Number.POSITIVE_INFINITY;
    let re = Number.NEGATIVE_INFINITY;
    let rn = Number.NEGATIVE_INFINITY;
    for (const [lng, lat] of ring) {
      if (lng < rw) rw = lng;
      if (lng > re) re = lng;
      if (lat < rs) rs = lat;
      if (lat > rn) rn = lat;
    }

    // A non-finite ring cannot produce a usable grid extent, and the per-query path
    // it replaces read every such point as sunlit. Dropping it here rather than per
    // sun is the same test asked once — it does not involve the sun.
    if (!Number.isFinite(rw + rs + re + rn)) continue;

    const flat = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      flat[i * 2] = ring[i][0];
      flat[i * 2 + 1] = ring[i][1];
    }
    casters.push({
      flat,
      openCount: openRingLength(ring),
      capIndices: null,
      heightM: prism.heightM,
      west: rw, south: rs, east: re, north: rn,
    });
    const absHeight = Math.abs(prism.heightM);
    if (absHeight > maxAbsHeightM) maxAbsHeightM = absHeight;
  }

  return { casters, maxAbsHeightM, grid: buildFootprintGrid(casters) };
}

function buildFootprintGrid(casters: Caster[]): FootprintGrid | null {
  if (casters.length < GRID_MIN_CASTERS) return null;

  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const c of casters) {
    if (c.west < west) west = c.west;
    if (c.east > east) east = c.east;
    if (c.south < south) south = c.south;
    if (c.north > north) north = c.north;
  }

  const side = Math.min(
    MAX_FOOTPRINT_GRID_SIDE,
    Math.max(1, Math.ceil(Math.sqrt(casters.length / CASTERS_PER_FOOTPRINT_CELL)))
  );
  // A zero span (every footprint on one line) would divide by zero; one cell covers it.
  const cellLng = (east - west) / side || 1;
  const cellLat = (north - south) / side || 1;

  const cells: Array<number[] | undefined> = new Array(side * side);
  for (let i = 0; i < casters.length; i++) {
    const c = casters[i];
    const x0 = cellIndex(c.west - west, cellLng, side);
    const x1 = cellIndex(c.east - west, cellLng, side);
    const y0 = cellIndex(c.south - south, cellLat, side);
    const y1 = cellIndex(c.north - south, cellLat, side);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * side + x;
        const bucket = cells[k];
        if (bucket === undefined) cells[k] = [i];
        else bucket.push(i);
      }
    }
  }

  return { west, south, cellLng, cellLat, nx: side, ny: side, cells };
}

/**
 * Indices of every caster whose shadow could possibly reach `region`, in prism order.
 *
 * A shadow is its footprint translated by at most `maxAbsHeightM / tan(altitude)`
 * metres, so a footprint further than that from `region` cannot reach it whatever
 * the azimuth. Expanding the region by that one radius and reading the footprint
 * grid is therefore a **conservative superset** of what the exact per-prism test
 * accepts — the caller still runs that test, so the surviving candidate list is
 * identical to a full scan's, right down to its order.
 *
 * Returns `null` for "scan everything", which is the honest answer whenever the
 * radius is not a usable finite number: a sun on the horizon, or below it.
 */
function castersNear(
  prepared: ShadowCasters,
  region: IndexRegion,
  tanAltitude: number,
  mPerLat: number,
  mPerLng: number
): number[] | null {
  const grid = prepared.grid;
  if (!grid) return null;

  const reachM = Math.abs(prepared.maxAbsHeightM / tanAltitude);
  if (!Number.isFinite(reachM)) return null;

  const padLng = reachM / mPerLng;
  const padLat = reachM / mPerLat;
  if (!Number.isFinite(padLng + padLat)) return null;

  const x0 = cellIndex(region.west - padLng - grid.west, grid.cellLng, grid.nx);
  const x1 = cellIndex(region.east + padLng - grid.west, grid.cellLng, grid.nx);
  const y0 = cellIndex(region.south - padLat - grid.south, grid.cellLat, grid.ny);
  const y1 = cellIndex(region.north + padLat - grid.south, grid.cellLat, grid.ny);

  const hits: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const bucket = grid.cells[y * grid.nx + x];
      // Appended one at a time rather than spread: `push(...bucket)` passes the whole
      // bucket as call arguments, and a degenerate footprint distribution — every
      // prism in one cell, which the zero-span fallback above makes reachable — would
      // throw `RangeError` on a large enough set.
      if (bucket !== undefined) for (const index of bucket) hits.push(index);
    }
  }

  // Prism order, deduplicated: a footprint spanning several cells appears once per
  // cell. Restoring the original order keeps every downstream number — the grid
  // sizing, the bucket contents — bit-identical to what a full scan produces.
  hits.sort((a, b) => a - b);
  let write = 0;
  for (let i = 0; i < hits.length; i++) {
    if (i === 0 || hits[i] !== hits[i - 1]) hits[write++] = hits[i];
  }
  hits.length = write;
  return hits;
}

/**
 * Build the shadow geometry once, then answer point queries against it.
 *
 * `mPerLat` / `mPerLng` are **passed in, not derived**: one index means one
 * projection frame, and handing over the pair the caller already computed is what
 * makes the answer identical to the per-query path it replaces.
 *
 * **Precondition — every point you will ask about must lie inside `region`.**
 * Prisms whose shadow cannot reach `region` are dropped before they are ever
 * triangulated, which is what contains the low-sun blow-up (a 20 m building at 0.5°
 * altitude "casts" 2.3 km). Query outside the region you declared and a dropped
 * prism reads as open sun. Pass `null` to keep every prism.
 */
export function buildShadowIndex(
  prisms: BuildingPrism[],
  sunAzimuth: number,
  sunAltitude: number,
  mPerLat: number,
  mPerLng: number,
  region?: IndexRegion | null
): ShadowIndex {
  return buildShadowIndexFor(
    prepareShadowCasters(prisms), sunAzimuth, sunAltitude, mPerLat, mPerLng, region
  );
}

/** `buildShadowIndex` over casters prepared once and reused across sun positions. */
export function buildShadowIndexFor(
  prepared: ShadowCasters,
  sunAzimuth: number,
  sunAltitude: number,
  mPerLat: number,
  mPerLng: number,
  region?: IndexRegion | null
): ShadowIndex {
  // ─── Phase 1: shadow bounds, no triangulation ───────────────────────────────
  // The shadow is a constant translation of the footprint, so its bounds are the
  // ring's bounds unioned with the ring's bounds shifted — computable without
  // earcutting anything. The shift is spelled exactly as `buildShadowTriangles`
  // spells it, so the bounds are the true extent of the vertices it will emit.
  // The three trig calls are hoisted out of the loop and nothing else about the
  // expression moves, so every shift is the same float it was when they were not.
  const tanAltitude = Math.tan(sunAltitude);
  const cosAzimuth = Math.cos(sunAzimuth);
  const sinAzimuth = Math.sin(sunAzimuth);

  const all = prepared.casters;
  const scan = region ? castersNear(prepared, region, tanAltitude, mPerLat, mPerLng) : null;
  const scanLength = scan ? scan.length : all.length;

  const candidates: Candidate[] = [];
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  for (let s = 0; s < scanLength; s++) {
    const caster = all[scan ? scan[s] : s];
    const rw = caster.west;
    const rs = caster.south;
    const re = caster.east;
    const rn = caster.north;

    const shadowLengthM = caster.heightM / tanAltitude;
    const dLat = (cosAzimuth * shadowLengthM) / mPerLat;
    const dLng = (sinAzimuth * shadowLengthM) / mPerLng;

    // A sun on the horizon makes the shift infinite, and an infinite coordinate does
    // the same to the bounds. Either would leave the grid with a non-finite extent,
    // which the coarsening loop below can never satisfy — it would spin forever.
    // Skipping matches what the per-query path already did: every comparison against
    // a non-finite vertex is false, so the point read as sunlit. (A NaN coordinate
    // needs no guard: it loses every `<` and `>` in the ring sweep that produced
    // these bounds, so they stay finite and the prism keeps the same harmless
    // triangles it always had.)
    if (!Number.isFinite(dLat + dLng)) continue;

    const cw = Math.min(rw, rw + dLng);
    const ce = Math.max(re, re + dLng);
    const cs = Math.min(rs, rs + dLat);
    const cn = Math.max(rn, rn + dLat);

    // ─── Phase 2: region filter ───────────────────────────────────────────────
    if (region && (cw > region.east || ce < region.west || cs > region.north || cn < region.south)) {
      continue;
    }

    candidates.push({ caster, dLng, dLat, west: cw, south: cs, east: ce, north: cn });
    if (cw < west) west = cw;
    if (ce > east) east = ce;
    if (cs < south) south = cs;
    if (cn > north) north = cn;
  }

  if (candidates.length === 0) return EMPTY_INDEX;

  // ─── Phase 3: triangulate the survivors, and only them ──────────────────────
  const triangles = candidates.map((c) => shadowTrianglesFlat(c.caster, c.dLng, c.dLat));

  // ─── The grid ───────────────────────────────────────────────────────────────
  // Sized off the objects rather than a constant: shadows grow at low sun, and a
  // fixed metre size degrades exactly where routing needs the index most.
  let spanSum = 0;
  for (const c of candidates) spanSum += Math.max(c.east - c.west, c.north - c.south);
  const meanSpanDeg = spanSum / candidates.length;

  let cellDeg = Math.min(MAX_CELL_M / mPerLat, Math.max(MIN_CELL_M / mPerLat, meanSpanDeg));
  const budget = Math.min(MAX_CELLS, Math.max(64, candidates.length * CELLS_PER_PRISM));

  let nx = 1;
  let ny = 1;
  for (;;) {
    nx = Math.max(1, Math.ceil((east - west) / cellDeg));
    ny = Math.max(1, Math.ceil((north - south) / cellDeg));
    if (nx * ny <= budget) break;
    cellDeg *= 2;
  }

  // Prism indices, not triangle indices: ~9 entries per prism (≈18k at 2,000
  // buildings) instead of ~9 per triangle (≈650k). Testing a candidate's ~36
  // triangles is free next to the earcut this eliminates.
  const cells: Array<number[] | undefined> = new Array(nx * ny);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const x0 = cellIndex(c.west - west, cellDeg, nx);
    const x1 = cellIndex(c.east - west, cellDeg, nx);
    const y0 = cellIndex(c.south - south, cellDeg, ny);
    const y1 = cellIndex(c.north - south, cellDeg, ny);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * nx + x;
        const bucket = cells[k];
        if (bucket === undefined) cells[k] = [i];
        else bucket.push(i);
      }
    }
  }

  return {
    prismCount: candidates.length,

    isShaded(lng: number, lat: number): boolean {
      if (lng < west || lng > east || lat < south || lat > north) return false;

      const bucket =
        cells[cellIndex(lat - south, cellDeg, ny) * nx + cellIndex(lng - west, cellDeg, nx)];
      if (bucket === undefined) return false;

      // Two complete passes, never interleaved. A roof is painted lit even when it
      // stands inside a taller neighbour's shadow, so every footprint in the
      // candidate set must be ruled out before any triangle is tested — interleaving
      // silently changes the answer wherever those two overlap.
      //
      // No bounds short-circuit in front of the ray cast, tempting as it looks. It
      // would be exact for a finite ring, and it is not exact for a ring carrying a
      // NaN vertex: NaN loses every comparison in the bounds sweep, so the bounds
      // exclude it while `pointInPolygonFlat` still flips parity on its edges. The
      // per-query path this index replaces cast the ray unconditionally, and matching
      // it is worth more than the ~2% the short-circuit measured.
      for (const i of bucket) {
        if (pointInPolygonFlat(lng, lat, candidates[i].caster.flat)) return false;
      }
      for (const i of bucket) {
        if (pointInTrianglesFlat(lng, lat, triangles[i])) return true;
      }
      return false;
    },
  };
}

/**
 * `buildShadowTriangles`, emitted straight into flat `x, y` pairs.
 *
 * Same triangles, same order, same floats — pinned by a test against
 * `buildShadowTriangles` itself, because the renderer still uses that one and the
 * two must not drift. What this avoids is the *shape*: the tuple form allocates an
 * open ring, a shifted ring and ~36 two-element arrays per prism, all discarded
 * immediately, and a sweep pays that for every prism at every hour. Here the only
 * allocations are the shifted ring and the output.
 *
 * The near cap is cut once in `prepareShadowCasters` and reused: the footprint does
 * not move when the sun does. The far cap is cut per sun over the same flat
 * coordinates `triangulateRing` would have built, so `earcut` sees identical input
 * and returns identical indices.
 *
 * Exported only so that test can exist. `shadowIndex.test.ts`'s frozen reference
 * compares the two *through* `isShaded`, which cannot see a difference that changes
 * the triangles without changing the region they cover — and a translated ring is
 * exactly that kind of difference. Nothing in `app/` calls this.
 */
export function shadowTrianglesFlat(
  caster: Caster,
  dLng: number,
  dLat: number
): Float64Array {
  const n = caster.openCount;
  if (n < 3) return EMPTY_TRIANGLES;

  const ring = caster.flat;
  const shifted = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    shifted[i * 2] = ring[i * 2] + dLng;
    shifted[i * 2 + 1] = ring[i * 2 + 1] + dLat;
  }

  if (caster.capIndices === null) {
    caster.capIndices = earcut(ring.subarray(0, n * 2), [], 2);
  }
  const nearCap = caster.capIndices;
  const farCap = earcut(shifted, [], 2);

  const out = new Float64Array((6 * n + nearCap.length + farCap.length) * 2);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ix = ring[i * 2];
    const iy = ring[i * 2 + 1];
    const jx = ring[j * 2];
    const jy = ring[j * 2 + 1];
    const six = shifted[i * 2];
    const siy = shifted[i * 2 + 1];
    const sjx = shifted[j * 2];
    const sjy = shifted[j * 2 + 1];
    // pts[i], pts[j], shifted[i] — then pts[j], shifted[j], shifted[i].
    out[w] = ix; out[w + 1] = iy;
    out[w + 2] = jx; out[w + 3] = jy;
    out[w + 4] = six; out[w + 5] = siy;
    out[w + 6] = jx; out[w + 7] = jy;
    out[w + 8] = sjx; out[w + 9] = sjy;
    out[w + 10] = six; out[w + 11] = siy;
    w += 12;
  }
  for (const index of nearCap) {
    out[w++] = ring[index * 2];
    out[w++] = ring[index * 2 + 1];
  }
  for (const index of farCap) {
    out[w++] = shifted[index * 2];
    out[w++] = shifted[index * 2 + 1];
  }
  return out;
}

/** A ring too short to have an interior casts nothing. Shared — it is never written. */
const EMPTY_TRIANGLES = new Float64Array(0);

/** `openRing(ring).length`, without slicing a copy to count it. */
function openRingLength(ring: [number, number][]): number {
  const last = ring.length - 1;
  const closed =
    ring.length > 1 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  return closed ? last : ring.length;
}

/** `pointInPolygon` over the flat form, arithmetic for arithmetic. */
function pointInPolygonFlat(lng: number, lat: number, ring: Float64Array): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-20) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** `pointInTriangles` over the flat form. */
function pointInTrianglesFlat(lng: number, lat: number, tris: Float64Array): boolean {
  for (let i = 0; i + 5 < tris.length; i += 6) {
    if (
      pointInTriangleXY(lng, lat, tris[i], tris[i + 1], tris[i + 2], tris[i + 3], tris[i + 4], tris[i + 5])
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Grid index for an offset from the grid's origin.
 *
 * Clamped rather than reasoned about: the grid spans the union of exactly these
 * boxes, so only floating-point `ceil` can put an index out of range. A NaN offset
 * falls through as NaN and lands on an empty bucket, which is the sunlit answer the
 * per-query path also gave.
 */
function cellIndex(offsetDeg: number, cellDeg: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(offsetDeg / cellDeg)));
}

/**
 * Is this point in the ground shadow of any prism?
 *
 * A point standing on a building's own footprint is reported as *not* shaded:
 * the renderer paints roofs lit, and a sidewalk sample that lands on a footprint
 * is a geometry-precision artefact rather than real shade.
 *
 * One query, one index — the same O(prisms) triangulation the per-query form always
 * did, so nothing here got slower. It lives on for the callers that genuinely ask
 * once; anything asking twice should build the index itself and keep it.
 */
export function pointInPrismShadow(
  prisms: BuildingPrism[],
  lng: number,
  lat: number,
  sunAzimuth: number,
  sunAltitude: number,
  mPerLat: number,
  mPerLng: number
): boolean {
  return buildShadowIndex(prisms, sunAzimuth, sunAltitude, mPerLat, mPerLng, null).isShaded(lng, lat);
}

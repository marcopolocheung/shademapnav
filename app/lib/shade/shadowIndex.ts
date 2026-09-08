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
 * **One documented divergence.** A point outside the indexed area answers `false`
 * without testing anything. The per-query path could answer `true` there, but only
 * from a zero-area triangle: at a near-horizon sun the shadow's side walls collapse
 * to a single longitude, and `pointInTriangle`'s absolute `|denom| < 1e-20` guard
 * stops catching that once the latitude span reaches ~0.09°, so it reports a point
 * hundreds of metres outside the triangle's own bounds as inside it. Inside the grid
 * the two agree exactly, degenerate slivers included, because the same predicate runs
 * over the same triangles. See #163.
 */

import {
  type BuildingPrism,
  buildShadowTriangles,
  pointInPolygon,
  pointInTriangleXY,
} from "./geometry";

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
  ring: [number, number][];
  heightM: number;
  west: number;
  south: number;
  east: number;
  north: number;
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
  // ─── Phase 1: shadow bounds, no triangulation ───────────────────────────────
  // The shadow is a constant translation of the footprint, so its bounds are the
  // ring's bounds unioned with the ring's bounds shifted — computable without
  // earcutting anything. The shift is spelled exactly as `buildShadowTriangles`
  // spells it, so the bounds are the true extent of the vertices it will emit.
  const candidates: Candidate[] = [];
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

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

    const shadowLengthM = prism.heightM / Math.tan(sunAltitude);
    const dLat = (Math.cos(sunAzimuth) * shadowLengthM) / mPerLat;
    const dLng = (Math.sin(sunAzimuth) * shadowLengthM) / mPerLng;

    // A sun on the horizon makes the shift infinite, and an infinite coordinate does
    // the same to the bounds. Either would leave the grid with a non-finite extent,
    // which the coarsening loop below can never satisfy — it would spin forever.
    // Skipping matches what the per-query path already did: every comparison against
    // a non-finite vertex is false, so the point read as sunlit. (A NaN coordinate
    // needs no guard: it loses every `<` and `>` in the sweep above, so the bounds
    // stay finite and the prism keeps the same harmless triangles it always had.)
    if (!Number.isFinite(rw + rs + re + rn) || !Number.isFinite(dLat + dLng)) continue;

    const cw = Math.min(rw, rw + dLng);
    const ce = Math.max(re, re + dLng);
    const cs = Math.min(rs, rs + dLat);
    const cn = Math.max(rn, rn + dLat);

    // ─── Phase 2: region filter ───────────────────────────────────────────────
    if (region && (cw > region.east || ce < region.west || cs > region.north || cn < region.south)) {
      continue;
    }

    candidates.push({ ring, heightM: prism.heightM, west: cw, south: cs, east: ce, north: cn });
    if (cw < west) west = cw;
    if (ce > east) east = ce;
    if (cs < south) south = cs;
    if (cn > north) north = cn;
  }

  if (candidates.length === 0) return EMPTY_INDEX;

  // ─── Phase 3: triangulate the survivors, and only them ──────────────────────
  // `buildShadowTriangles` is reused rather than reimplemented so the vertex floats
  // are the same ones the per-query path produced. Flattened to float64 because JS
  // numbers *are* float64: f32 would silently move a vertex and change an answer.
  const triangles = candidates.map((c) =>
    flattenTriangles(
      buildShadowTriangles(c.ring, c.heightM, sunAzimuth, sunAltitude, mPerLat, mPerLng)
    )
  );

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
      for (const i of bucket) {
        if (pointInPolygon(lng, lat, candidates[i].ring)) return false;
      }
      for (const i of bucket) {
        if (pointInTrianglesFlat(lng, lat, triangles[i])) return true;
      }
      return false;
    },
  };
}

/** Flat `x, y` pairs — three consecutive vertices, six numbers, per triangle. */
function flattenTriangles(tris: [number, number][]): Float64Array {
  const out = new Float64Array(tris.length * 2);
  for (let i = 0; i < tris.length; i++) {
    out[i * 2] = tris[i][0];
    out[i * 2 + 1] = tris[i][1];
  }
  return out;
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

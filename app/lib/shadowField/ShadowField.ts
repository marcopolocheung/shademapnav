/**
 * The shadow field (Track A, checkpoint A2).
 *
 * Shadow in this app has always been whatever the renderer painted: `useNavigation`
 * draws the map canvas into a 2D context and classifies blue pixels. That answer is
 * viewport-scoped, zoom-dependent, costs a re-render per hour, and can never count a
 * shadow source the renderer doesn't draw.
 *
 * `ShadowField` is the replacement: given a coordinate or an edge and a time, compute
 * a shadow fraction from geometry — no camera, no canvas, no main thread required.
 * Every answer carries where it came from and how much to trust it, because callers
 * need both (A4 falls back to the pixel path on low confidence, and the UI is only
 * allowed to show numbers it can explain).
 *
 * Nobody else implements shadow math. Other tracks import this.
 */

import SunCalc from "suncalc";
import {
  type BuildingPrism,
  type PrismSet,
  metersPerDegree,
} from "./geometry";
import {
  type IndexRegion,
  type ShadowCasters,
  type ShadowIndex,
  buildShadowIndexFor,
  prepareShadowCasters,
} from "./shadowIndex";

// ─── The published contract ───────────────────────────────────────────────────

/**
 * Where a shadow answer came from.
 *
 * `"none"` means no geometry backed the answer, and `confidence` says which kind:
 * 1 for a sun below the horizon (astronomically certain, no geometry needed) and
 * 0 for "no source covered this point", which is a request to fall back rather
 * than a claim of full sun. `"mixed"` and `"canopy"` are reserved for A7, `"canvas"`
 * for the pixel sampler when A4 wires it in as the fallback.
 */
export type ShadowSource = "tiles" | "overpass" | "canopy" | "mixed" | "canvas" | "none";

export interface ShadowSample {
  /** 0 = full sun, 1 = fully shadowed. */
  shadow: number;
  source: ShadowSource;
  /** 0–1. Below `LOW_CONFIDENCE` a caller should prefer another source. */
  confidence: number;
}

/** An edge in the routing graph, in its canonical (low→high node id) direction. */
export interface EdgeRef {
  from: [number, number];
  to: [number, number];
}

/**
 * Shadow for both sidewalks of an edge. The left/right split is what lets Dijkstra
 * pick the shadowed side of a street and what Track B's "cross now" cue reads.
 */
export interface EdgeShadow {
  left: number;
  right: number;
  source: ShadowSource;
  confidence: number;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Whether any source can speak for an area — asked *before* sampling it.
 *
 * `sampleEdges` already reports a source and a confidence per edge, but only after
 * doing the work. A caller that must decide something up front — A4b decides whether
 * to read the map canvas at all, which costs a camera move and a full-canvas
 * readback — needs the same answer in advance, and this is the cheap half of
 * `sampleEdges`: resolve a provider, score it, do no geometry.
 */
export interface Coverage {
  source: ShadowSource;
  confidence: number;
}

export interface ShadowField {
  shadowAt(lng: number, lat: number, when: Date): ShadowSample;
  sampleEdges(edges: EdgeRef[], when: Date): EdgeShadow[];
  /** Which source, if any, could answer for this whole bbox. No geometry is built. */
  coverage(bbox: BBox, when: Date): Coverage;
  /** N times in one pass. Naive today; A6 makes it cheaper than N× `sampleEdges`. */
  sweep(edges: EdgeRef[], times: Date[]): EdgeShadow[][];
  /** Preload geometry so subsequent synchronous queries can answer. */
  ready(bbox: BBox): Promise<void>;
}

/**
 * A source of building prisms for an area.
 *
 * Two exist today — MapTiler vector tiles (what the renderer draws, synchronous,
 * viewport-scoped) and Overpass (slower, async, works anywhere). `prismsFor` must
 * return `null` rather than an empty set when the provider cannot speak for a bbox,
 * because "no buildings here" and "I haven't loaded this area" produce the same
 * shadow number and very different confidence.
 */
export interface PrismProvider {
  source: "tiles" | "overpass";
  prismsFor(bbox: BBox): PrismSet | null;
  load?(bbox: BBox): Promise<void>;
  /**
   * How complete this source's geometry is *right now*, as a 0–1 multiplier on its
   * base confidence. Absent means 1.
   *
   * `prismsFor` answers a yes/no question — can I speak for this area at all — and
   * that binary is too coarse for a source whose coverage degrades continuously.
   * MapTiler thins its building layer as you zoom out: still non-empty, so
   * `dataFactor` sees buildings and says nothing, while half the block is missing
   * and the field reports a sunlit street under a tower it never received.
   */
  completeness?(): number;
}

// ─── Tunables, all of them documented ─────────────────────────────────────────

/** Below this, `shadowAt`'s answer is a hint; callers should consult another source. */
export const LOW_CONFIDENCE = 0.5;

/**
 * Width of the batch partition that fixes one sun position per shadow index.
 *
 * One index is built per (sun, projection), but `SunCalc.getPosition` varies across
 * a route graph, so a batch has to be cut into cells that each get their own. 2 km
 * bounds the error by construction: the sun's altitude changes by ~0.018° across a
 * cell, which at 45° altitude is ~5 cm of shadow length and ~0.8 m at 10°. Both sit
 * under the pixel sampler's own ~1.2 m quantization, so the cut is invisible in the
 * agreement number while keeping the index count small.
 */
const SUN_CELL_M = 2000;

/** Sidewalk offset, matching `shadowSampling.sampleBothSidewalks` so A3 compares like with like. */
const SIDEWALK_OFFSET_M = 4.0;

/** Metres per degree used for the sidewalk offset — the same constant the pixel sampler uses. */
const SIDEWALK_M_PER_DEG = 111195;

/**
 * Sample count for one edge, matching what the pixel path actually asks for.
 *
 * `useNavigation` calls `sampleBothSidewalks(..., Math.max(3, ceil(distanceM / 25)))`, i.e. a
 * sample roughly every 25 m with a floor of 3 — not the function's default of 5. The sampler
 * then walks `i = 0..N` inclusive, so N+1 points land on each sidewalk. Mirroring the count
 * matters: a long edge sampled 6 times by one path and 40 times by the other disagrees for
 * reasons that have nothing to do with the shadow model, which is exactly what A3 must not
 * measure.
 */
export function edgeSampleCount(distanceM: number): number {
  return Math.max(3, Math.ceil(distanceM / 25));
}

/** Planar edge length in metres — good enough at street scale. */
function edgeLengthM(edge: EdgeRef): number {
  const { mPerLat, mPerLng } = metersPerDegree((edge.from[1] + edge.to[1]) / 2);
  const dx = (edge.to[0] - edge.from[0]) * mPerLng;
  const dy = (edge.to[1] - edge.from[1]) * mPerLat;
  return Math.sqrt(dx * dx + dy * dy);
}

/** The 5-point probe `queryPointShadow` and `computeBuildingShadowFraction` both already run. */
const POINT_OFFSETS_M: Array<[number, number]> = [
  [0, 0],
  [-4, 0],
  [4, 0],
  [0, -4],
  [0, 4],
];

/**
 * How far outside the query a provider must have geometry loaded, in metres.
 *
 * Shadow length is `height / tan(altitude)`, which diverges as the sun touches the
 * horizon — a 20 m building at 0.5° altitude "casts" 2.3 km. Asking a provider to
 * cover that is not practical, and past a couple of hundred metres the answer is
 * dominated by terrain and haze this model does not have, so the request is capped
 * and `confidenceFor` docks the answer near the horizon instead.
 *
 * Exported because a caller that preloads with `ready()` has to pad its bbox by the
 * same amount `sampleEdges` will: load one area and resolve another and the provider
 * declines an area it actually holds.
 */
export const QUERY_PAD_M = 400;

/** Below this sun altitude, shadow geometry stops being trustworthy. See `confidenceFor`. */
const LOW_SUN_ALTITUDE_RAD = (10 * Math.PI) / 180;

/**
 * Base trust per source.
 *
 * Tiles score higher because MapTiler resolves a `render_height` for every building
 * it serves; Overpass hands back raw OSM, where an untagged way falls through to a
 * flat default (see issue #120). Neither is measured ground truth — these are
 * priors, and A3's agreement harness is what turns them into calibrated numbers.
 */
const SOURCE_BASE_CONFIDENCE: Record<PrismProvider["source"], number> = {
  tiles: 0.8,
  overpass: 0.7,
};

/** Applied when the covering source holds no buildings at all for the area. */
const NO_GEOMETRY_FACTOR = 0.4;

// ─── Confidence ───────────────────────────────────────────────────────────────

/**
 * How much to trust one geometric shadow answer.
 *
 * Three independent doubts, multiplied:
 *
 * 1. **The source.** See `SOURCE_BASE_CONFIDENCE`.
 * 2. **The sun's altitude.** Shadow length goes as `1/tan(altitude)`, so near sunrise
 *    and sunset a 10% height error becomes a 10% error on a shadow several hundred
 *    metres long — the shadow *edge* lands in the wrong block. Ramps from 1 at 10°
 *    down to 0.3 at the horizon.
 * 3. **Whether the covering source actually holds any buildings.** A source that
 *    claims an area and returns nothing reads as full sun whether that area is an
 *    empty plaza or one whose buildings never loaded. The field cannot tell those
 *    apart, so it says so.
 *
 * 4. **How complete the source's geometry is right now.** Reported by the provider —
 *    see `PrismProvider.completeness`. A tile source zoomed out far enough to be
 *    served a decimated building layer is not the same source it is at street zoom.
 *
 * Note what this deliberately does *not* dock: a point that simply sits outside every
 * shadow. Once buildings are loaded, "the sun reaches here" is a confident answer, and
 * treating it as a doubt would send almost every sunlit sample to the fallback path.
 */
export function confidenceFor(
  source: PrismProvider["source"],
  sunAltitudeRad: number,
  prismsAvailable: number,
  completeness = 1
): number {
  const base = SOURCE_BASE_CONFIDENCE[source];

  const horizonFactor =
    sunAltitudeRad >= LOW_SUN_ALTITUDE_RAD
      ? 1
      : 0.3 + 0.7 * Math.max(0, sunAltitudeRad / LOW_SUN_ALTITUDE_RAD);

  const dataFactor = prismsAvailable > 0 ? 1 : NO_GEOMETRY_FACTOR;

  return base * horizonFactor * dataFactor * Math.max(0, Math.min(1, completeness));
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** A bbox around a point, padded by `padM` metres. */
export function bboxAroundPoint(lng: number, lat: number, padM: number): BBox {
  const { mPerLat, mPerLng } = metersPerDegree(lat);
  return {
    west: lng - padM / mPerLng,
    east: lng + padM / mPerLng,
    south: lat - padM / mPerLat,
    north: lat + padM / mPerLat,
  };
}

/** A bbox covering every endpoint of every edge, padded by `padM` metres. */
export function bboxAroundEdges(edges: EdgeRef[], padM: number): BBox | null {
  if (edges.length === 0) return null;

  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  for (const edge of edges) {
    for (const [lng, lat] of [edge.from, edge.to]) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }

  const { mPerLat, mPerLng } = metersPerDegree((south + north) / 2);
  return {
    west: west - padM / mPerLng,
    east: east + padM / mPerLng,
    south: south - padM / mPerLat,
    north: north + padM / mPerLat,
  };
}

// ─── The geometry-backed implementation ───────────────────────────────────────

interface Resolved {
  set: PrismSet;
  source: PrismProvider["source"];
  /** The provider's own completeness at the moment it answered. */
  completeness: number;
}

/** The sun, and the shadows it casts, shared by every edge in one `SUN_CELL_M` cell. */
interface SunCell {
  sun: { azimuth: number; altitude: number };
  /** `null` when no geometry resolved, or the sun is down for this cell. */
  index: ShadowIndex | null;
}

/**
 * One `SUN_CELL_M` cell, with everything about it that no time changes.
 *
 * The partition, each cell's centroid, its projection frame and the region its
 * samples provably stay inside are all pure functions of the edges — so a sweep
 * computes them once and reuses them at every hour (A6). Only `SunCalc.getPosition`
 * and the shadow index itself are per-time.
 */
interface SunCellPlan {
  /** Indices into the edge batch, in batch order. */
  members: number[];
  lng: number;
  lat: number;
  mPerLat: number;
  mPerLng: number;
  region: IndexRegion;
}

/** A batch of edges, with everything about it that no time changes (A6). */
interface BatchPlan {
  cells: SunCellPlan[];
  /** Per edge: its two sidewalk offsets and how many points to walk along each. */
  left: Array<[number, number]>;
  right: Array<[number, number]>;
  steps: number[];
}

/** The bbox of exactly these points — the region a caller may then query within. */
function regionOver(points: Array<[number, number]>): IndexRegion {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/**
 * Everything about a batch of edges that no time changes, computed once.
 *
 * Each edge's sidewalk offsets and sample count come first — they are pure functions
 * of the edge, and recomputing them per hour was `metersPerDegree` and a pair of
 * allocations per edge per hour.
 *
 * The batch is then cut into `SUN_CELL_M` cells.
 *
 * `SunCalc.getPosition` was called per edge midpoint, but an index is built for a
 * single sun and a single projection frame. Cutting the batch into `SUN_CELL_M`
 * cells bounds that substitution instead of hand-waving it, and the index's own
 * region filter means each cell only triangulates prisms that can reach it — so
 * the total earcut work stays ~P rather than P per cell.
 *
 * Nothing here depends on the time, which is the point: `sweep` computes the plan
 * once and hands it to `sunCellsAt` at every hour, and `sampleEdges` computes the
 * same plan for its one hour. That is what keeps the two paths identical.
 */
function planBatch(edges: EdgeRef[]): BatchPlan {
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const steps: number[] = [];
  for (const edge of edges) {
    const offsets = sidewalkOffsets(edge);
    left.push(offsets.left);
    right.push(offsets.right);
    steps.push(edgeSampleCount(edgeLengthM(edge)));
  }

  if (edges.length === 0) return { cells: [], left, right, steps };

  // Cell size in degrees, from the batch's own latitude — one frame for the cut.
  const batchLat = edges.reduce((sum, e) => sum + (e.from[1] + e.to[1]) / 2, 0) / edges.length;
  const batch = metersPerDegree(batchLat);
  const cellLng = SUN_CELL_M / batch.mPerLng;
  const cellLat = SUN_CELL_M / batch.mPerLat;

  const groups = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const midLng = (edges[i].from[0] + edges[i].to[0]) / 2;
    const midLat = (edges[i].from[1] + edges[i].to[1]) / 2;
    const key = `${Math.floor(midLng / cellLng)},${Math.floor(midLat / cellLat)}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [i]);
    else group.push(i);
  }

  const cells: SunCellPlan[] = [];
  for (const members of groups.values()) {
    // The cell's own centroid, not its geometric centre: tighter when a cell holds
    // only a corner of a route, and still a pure function of the edges.
    let sumLng = 0;
    let sumLat = 0;
    for (const i of members) {
      sumLng += (edges[i].from[0] + edges[i].to[0]) / 2;
      sumLat += (edges[i].from[1] + edges[i].to[1]) / 2;
    }
    const lng = sumLng / members.length;
    const lat = sumLat / members.length;
    const { mPerLat, mPerLng } = metersPerDegree(lat);

    // The region is the bbox of the four offset corners of every edge in the cell.
    // Every sample point is a convex combination of an edge's endpoints plus one of
    // its two sidewalk offsets, so it provably lands inside — which is the
    // precondition the index's region filter needs.
    const corners: Array<[number, number]> = [];
    for (const i of members) {
      for (const end of [edges[i].from, edges[i].to]) {
        for (const offset of [left[i], right[i]]) {
          corners.push([end[0] + offset[0], end[1] + offset[1]]);
        }
      }
    }

    cells.push({ members, lng, lat, mPerLat, mPerLng, region: regionOver(corners) });
  }
  return { cells, left, right, steps };
}

/**
 * One sun cell per edge at one time, from a plan computed once.
 *
 * The `sun.altitude <= 0` short-circuit is per-cell rather than per-edge, so a batch
 * straddling sunrise resolves at cell granularity.
 */
function sunCellsAt(
  plan: BatchPlan,
  edgeCount: number,
  when: Date,
  casters: ShadowCasters | null
): SunCell[] {
  const out = new Array<SunCell>(edgeCount);
  for (const cell of plan.cells) {
    const sun = SunCalc.getPosition(when, cell.lat, cell.lng);
    const index =
      casters && sun.altitude > 0
        ? buildShadowIndexFor(
            casters, sun.azimuth, sun.altitude, cell.mPerLat, cell.mPerLng, cell.region
          )
        : null;
    for (const i of cell.members) out[i] = { sun, index };
  }
  return out;
}

/**
 * Prepared casters, keyed by the prism array they came from (A6).
 *
 * Preparation is per prism *set*, not per query, and both live providers already
 * cache: they hand back the same array until the geometry actually changes, and
 * neither mutates one in place — a new viewport or a new fetch builds a new array.
 * Keying on that array is therefore exactly the right invalidation, and a `WeakMap`
 * means a set that falls out of a provider's cache takes its preparation with it.
 *
 * Without this, `sampleEdges` flattened every prism in the city on every call, which
 * a route calculation makes several of. Module-level rather than per field because
 * two fields over the same provider are looking at the same geometry.
 */
const PREPARED = new WeakMap<BuildingPrism[], ShadowCasters>();

function preparedCastersFor(prisms: BuildingPrism[]): ShadowCasters {
  const hit = PREPARED.get(prisms);
  if (hit) return hit;
  const prepared = prepareShadowCasters(prisms);
  PREPARED.set(prisms, prepared);
  return prepared;
}

/**
 * A `ShadowField` over building prisms.
 *
 * Providers are consulted in order and the first one that can speak for the area
 * answers, so a caller can put the fast synchronous tile provider ahead of the
 * Overpass one and get the network path only where the renderer has nothing loaded.
 */
export function createGeometryShadowField(providers: PrismProvider[]): ShadowField {
  function resolve(bbox: BBox): Resolved | null {
    for (const provider of providers) {
      const set = provider.prismsFor(bbox);
      if (set) {
        return { set, source: provider.source, completeness: provider.completeness?.() ?? 1 };
      }
    }
    return null;
  }

  /**
   * Is this exact point in shadow? One test, no neighbourhood.
   *
   * This is the unit both public queries are built from, and keeping it a single
   * point matters: `sampleEdges` has already displaced its samples ±4 m onto the
   * sidewalks, so averaging a further ±4 m neighbourhood around each one would
   * smear a sidewalk across the street it belongs to.
   */
  function pointShadow(index: ShadowIndex, lng: number, lat: number): number {
    return index.isShadowed(lng, lat) ? 1 : 0;
  }

  function sampleFor(resolved: Resolved, shadow: number, sunAltitude: number): ShadowSample {
    return {
      shadow,
      source: resolved.source,
      confidence: confidenceFor(
        resolved.source, sunAltitude, resolved.set.prisms.length, resolved.completeness,
      ),
    };
  }

  /**
   * A point query, softened over a small neighbourhood.
   *
   * `queryPointShadow` and `computeBuildingShadowFraction` have both averaged a
   * 5-offset ±4 m probe for a while, and the softening is right for a *place* —
   * "is this terrace shadowed?" is a question about a few square metres, not about
   * one infinitely small point that a metre of geometry error could move in or out
   * of shadow. Edge sampling deliberately does not do this; see `pointShadow`.
   */
  function probe(
    resolved: Resolved | null,
    lng: number,
    lat: number,
    sunAzimuth: number,
    sunAltitude: number
  ): ShadowSample {
    if (!resolved) return { shadow: 0, source: "none", confidence: 0 };

    const { mPerLat, mPerLng } = metersPerDegree(lat);
    const offsets = POINT_OFFSETS_M.map(
      ([dxM, dyM]) => [lng + dxM / mPerLng, lat + dyM / mPerLat] as [number, number]
    );
    const index = buildShadowIndexFor(
      preparedCastersFor(resolved.set.prisms),
      sunAzimuth, sunAltitude, mPerLat, mPerLng, regionOver(offsets)
    );

    let shadowed = 0;
    for (const [sampleLng, sampleLat] of offsets) {
      shadowed += pointShadow(index, sampleLng, sampleLat);
    }

    return sampleFor(resolved, shadowed / POINT_OFFSETS_M.length, sunAltitude);
  }

  function shadowAt(lng: number, lat: number, when: Date): ShadowSample {
    const sun = SunCalc.getPosition(when, lat, lng);
    if (sun.altitude <= 0) return nightSample();

    const resolved = resolve(bboxAroundPoint(lng, lat, QUERY_PAD_M));
    return probe(resolved, lng, lat, sun.azimuth, sun.altitude);
  }

  function sampleEdgesWithSun(
    edges: EdgeRef[],
    resolved: Resolved | null,
    plan: BatchPlan,
    cells: SunCell[]
  ): EdgeShadow[] {
    return edges.map((edge, edgeIndex) => {
      const cell = cells[edgeIndex];
      const sun = cell.sun;

      if (sun.altitude <= 0) {
        const night = nightSample();
        return { left: 1, right: 1, source: night.source, confidence: night.confidence };
      }

      const leftOffset = plan.left[edgeIndex];
      const rightOffset = plan.right[edgeIndex];
      const steps = plan.steps[edgeIndex];

      // One point per sample, exactly where `sampleBothSidewalks` reads its pixel.
      const walk = (offset: [number, number]) => {
        if (!resolved || !cell.index) {
          return { shadow: 0, confidence: 0, source: "none" as ShadowSource };
        }

        let sum = 0;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          sum += pointShadow(
            cell.index,
            edge.from[0] + t * (edge.to[0] - edge.from[0]) + offset[0],
            edge.from[1] + t * (edge.to[1] - edge.from[1]) + offset[1]
          );
        }

        const sample = sampleFor(resolved, sum / (steps + 1), sun.altitude);
        return { shadow: sample.shadow, confidence: sample.confidence, source: sample.source };
      };

      const left = walk(leftOffset);
      const right = walk(rightOffset);

      return {
        left: left.shadow,
        right: right.shadow,
        source: left.source,
        // The whole edge is only as trustworthy as its least-covered sidewalk.
        confidence: Math.min(left.confidence, right.confidence),
      };
    });
  }

  function sampleEdges(edges: EdgeRef[], when: Date): EdgeShadow[] {
    const bbox = bboxAroundEdges(edges, QUERY_PAD_M);
    const resolved = bbox ? resolve(bbox) : null;
    const plan = planBatch(edges);
    const casters = resolved ? preparedCastersFor(resolved.set.prisms) : null;
    return sampleEdgesWithSun(edges, resolved, plan, sunCellsAt(plan, edges.length, when, casters));
  }

  return {
    shadowAt,
    sampleEdges,

    coverage(bbox, when) {
      const lng = (bbox.west + bbox.east) / 2;
      const lat = (bbox.south + bbox.north) / 2;

      // Below the horizon there is nothing to resolve and nothing to doubt: the
      // whole area is shadowed, and `sampleEdges` will say so without consulting a
      // provider. Reporting full confidence here is what lets a caller skip a
      // fallback path it would never have used.
      const sun = SunCalc.getPosition(when, lat, lng);
      if (sun.altitude <= 0) {
        const night = nightSample();
        return { source: night.source, confidence: night.confidence };
      }

      const resolved = resolve(bbox);
      if (!resolved) return { source: "none", confidence: 0 };

      return {
        source: resolved.source,
        confidence: confidenceFor(
          resolved.source, sun.altitude, resolved.set.prisms.length, resolved.completeness,
        ),
      };
    },

    sweep(edges, times) {
      // A6. Everything that does not depend on the hour is computed once: the
      // provider is resolved once, the sun-cell partition and each cell's region
      // once, and each prism's ring bounds and footprint bucket once. What remains
      // per hour is the sun position, the shadow shift, and the point queries —
      // which is why N hours cost far less than N samples. The results are the same
      // floats N separate `sampleEdges` calls produce, and a test pins that.
      const bbox = bboxAroundEdges(edges, QUERY_PAD_M);
      const resolved = bbox ? resolve(bbox) : null;
      const plan = planBatch(edges);
      const casters = resolved ? preparedCastersFor(resolved.set.prisms) : null;
      return times.map((when) =>
        sampleEdgesWithSun(edges, resolved, plan, sunCellsAt(plan, edges.length, when, casters))
      );
    },

    async ready(bbox) {
      await Promise.all(providers.map((provider) => provider.load?.(bbox)));
    },
  };
}

/** No geometry is consulted when the sun is down, and none is needed. */
function nightSample(): ShadowSample {
  return { shadow: 1, source: "none", confidence: 1 };
}

/**
 * Perpendicular ±4 m offsets for an edge's left and right sidewalks.
 *
 * Deliberately mirrors `shadowSampling.sampleBothSidewalks` — the same offset, the
 * same 111195 m/deg constant, the same sign convention — so that the field and the
 * pixel sampler are looking at the same two lines and A3's disagreement number
 * measures the shadow model rather than a difference in where each one stood.
 */
export function sidewalkOffsets(edge: EdgeRef): {
  left: [number, number];
  right: [number, number];
} {
  const latMid = (edge.from[1] + edge.to[1]) / 2;
  const cosLat = Math.max(1e-10, Math.cos((latMid * Math.PI) / 180));
  const dx = (edge.to[0] - edge.from[0]) * cosLat;
  const dy = edge.to[1] - edge.from[1];
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len <= 1e-10) {
    return { left: [0, 0], right: [0, 0] };
  }

  const perpLng = (-dy / len) * (SIDEWALK_OFFSET_M / (SIDEWALK_M_PER_DEG * cosLat));
  const perpLat = (dx / len) * (SIDEWALK_OFFSET_M / SIDEWALK_M_PER_DEG);

  return { left: [perpLng, perpLat], right: [-perpLng, -perpLat] };
}

// ─── Providers ────────────────────────────────────────────────────────────────

/**
 * A provider over a fixed prism set covering a fixed area.
 *
 * Used by tests and by callers that already hold geometry (the agent's `check_shadow`
 * has the Overpass footprints in hand). The live tile and Overpass providers, with
 * their caches, land with A4 when routing switches over.
 */
export function staticPrismProvider(
  set: PrismSet,
  coverage: BBox,
  source: PrismProvider["source"]
): PrismProvider {
  return {
    source,
    prismsFor(bbox) {
      return bboxContains(coverage, bbox) ? set : null;
    },
  };
}

/** True when `outer` fully contains `inner`. */
export function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    outer.west <= inner.west &&
    outer.east >= inner.east &&
    outer.south <= inner.south &&
    outer.north >= inner.north
  );
}

/**
 * The shade field (Track A, checkpoint A2).
 *
 * Shade in this app has always been whatever the renderer painted: `useNavigation`
 * draws the map canvas into a 2D context and classifies blue pixels. That answer is
 * viewport-scoped, zoom-dependent, costs a re-render per hour, and can never count a
 * shade source the renderer doesn't draw.
 *
 * `ShadeField` is the replacement: given a coordinate or an edge and a time, compute
 * a shade fraction from geometry — no camera, no canvas, no main thread required.
 * Every answer carries where it came from and how much to trust it, because callers
 * need both (A4 falls back to the pixel path on low confidence, and the UI is only
 * allowed to show numbers it can explain).
 *
 * Nobody else implements shade math. Other tracks import this.
 */

import SunCalc from "suncalc";
import {
  type PrismSet,
  metersPerDegree,
  pointInPrismShadow,
} from "./geometry";

// ─── The published contract ───────────────────────────────────────────────────

/**
 * Where a shade answer came from.
 *
 * `"none"` means no geometry backed the answer, and `confidence` says which kind:
 * 1 for a sun below the horizon (astronomically certain, no geometry needed) and
 * 0 for "no source covered this point", which is a request to fall back rather
 * than a claim of full sun. `"mixed"` and `"canopy"` are reserved for A7, `"canvas"`
 * for the pixel sampler when A4 wires it in as the fallback.
 */
export type ShadeSource = "tiles" | "overpass" | "canopy" | "mixed" | "canvas" | "none";

export interface ShadeSample {
  /** 0 = full sun, 1 = fully shaded. */
  shade: number;
  source: ShadeSource;
  /** 0–1. Below `LOW_CONFIDENCE` a caller should prefer another source. */
  confidence: number;
}

/** An edge in the routing graph, in its canonical (low→high node id) direction. */
export interface EdgeRef {
  from: [number, number];
  to: [number, number];
}

/**
 * Shade for both sidewalks of an edge. The left/right split is what lets Dijkstra
 * pick the shaded side of a street and what Track B's "cross now" cue reads.
 */
export interface EdgeShade {
  left: number;
  right: number;
  source: ShadeSource;
  confidence: number;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ShadeField {
  shadeAt(lng: number, lat: number, when: Date): ShadeSample;
  sampleEdges(edges: EdgeRef[], when: Date): EdgeShade[];
  /** N times in one pass. Naive today; A6 makes it cheaper than N× `sampleEdges`. */
  sweep(edges: EdgeRef[], times: Date[]): EdgeShade[][];
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
 * shade number and very different confidence.
 */
export interface PrismProvider {
  source: "tiles" | "overpass";
  prismsFor(bbox: BBox): PrismSet | null;
  load?(bbox: BBox): Promise<void>;
}

// ─── Tunables, all of them documented ─────────────────────────────────────────

/** Below this, `shadeAt`'s answer is a hint; callers should consult another source. */
export const LOW_CONFIDENCE = 0.5;

/** Sidewalk offset, matching `shadeSampling.sampleBothSidewalks` so A3 compares like with like. */
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
 * reasons that have nothing to do with the shade model, which is exactly what A3 must not
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

/** The 5-point probe `queryPointShade` and `computeBuildingShadeFraction` both already run. */
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
 */
const QUERY_PAD_M = 400;

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
 * How much to trust one geometric shade answer.
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
 * Note what this deliberately does *not* dock: a point that simply sits outside every
 * shadow. Once buildings are loaded, "the sun reaches here" is a confident answer, and
 * treating it as a doubt would send almost every sunlit sample to the fallback path.
 */
export function confidenceFor(
  source: PrismProvider["source"],
  sunAltitudeRad: number,
  prismsAvailable: number
): number {
  const base = SOURCE_BASE_CONFIDENCE[source];

  const horizonFactor =
    sunAltitudeRad >= LOW_SUN_ALTITUDE_RAD
      ? 1
      : 0.3 + 0.7 * Math.max(0, sunAltitudeRad / LOW_SUN_ALTITUDE_RAD);

  const dataFactor = prismsAvailable > 0 ? 1 : NO_GEOMETRY_FACTOR;

  return base * horizonFactor * dataFactor;
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
}

/**
 * A `ShadeField` over building prisms.
 *
 * Providers are consulted in order and the first one that can speak for the area
 * answers, so a caller can put the fast synchronous tile provider ahead of the
 * Overpass one and get the network path only where the renderer has nothing loaded.
 */
export function createGeometryShadeField(providers: PrismProvider[]): ShadeField {
  function resolve(bbox: BBox): Resolved | null {
    for (const provider of providers) {
      const set = provider.prismsFor(bbox);
      if (set) return { set, source: provider.source };
    }
    return null;
  }

  /**
   * Is this exact point in shade? One test, no neighbourhood.
   *
   * This is the unit both public queries are built from, and keeping it a single
   * point matters: `sampleEdges` has already displaced its samples ±4 m onto the
   * sidewalks, so averaging a further ±4 m neighbourhood around each one would
   * smear a sidewalk across the street it belongs to.
   */
  function pointShade(
    resolved: Resolved,
    lng: number,
    lat: number,
    sunAzimuth: number,
    sunAltitude: number
  ): number {
    const { mPerLat, mPerLng } = metersPerDegree(lat);
    return pointInPrismShadow(
      resolved.set.prisms, lng, lat, sunAzimuth, sunAltitude, mPerLat, mPerLng
    )
      ? 1
      : 0;
  }

  function sampleFor(resolved: Resolved, shade: number, sunAltitude: number): ShadeSample {
    return {
      shade,
      source: resolved.source,
      confidence: confidenceFor(resolved.source, sunAltitude, resolved.set.prisms.length),
    };
  }

  /**
   * A point query, softened over a small neighbourhood.
   *
   * `queryPointShade` and `computeBuildingShadeFraction` have both averaged a
   * 5-offset ±4 m probe for a while, and the softening is right for a *place* —
   * "is this terrace shaded?" is a question about a few square metres, not about
   * one infinitely small point that a metre of geometry error could move in or out
   * of shade. Edge sampling deliberately does not do this; see `pointShade`.
   */
  function probe(
    resolved: Resolved | null,
    lng: number,
    lat: number,
    sunAzimuth: number,
    sunAltitude: number
  ): ShadeSample {
    if (!resolved) return { shade: 0, source: "none", confidence: 0 };

    const { mPerLat, mPerLng } = metersPerDegree(lat);

    let shaded = 0;
    for (const [dxM, dyM] of POINT_OFFSETS_M) {
      shaded += pointShade(
        resolved,
        lng + dxM / mPerLng,
        lat + dyM / mPerLat,
        sunAzimuth,
        sunAltitude
      );
    }

    return sampleFor(resolved, shaded / POINT_OFFSETS_M.length, sunAltitude);
  }

  function shadeAt(lng: number, lat: number, when: Date): ShadeSample {
    const sun = SunCalc.getPosition(when, lat, lng);
    if (sun.altitude <= 0) return nightSample();

    const resolved = resolve(bboxAroundPoint(lng, lat, QUERY_PAD_M));
    return probe(resolved, lng, lat, sun.azimuth, sun.altitude);
  }

  function sampleEdgesWithSun(edges: EdgeRef[], when: Date, resolved: Resolved | null): EdgeShade[] {
    return edges.map((edge) => {
      const midLng = (edge.from[0] + edge.to[0]) / 2;
      const midLat = (edge.from[1] + edge.to[1]) / 2;
      const sun = SunCalc.getPosition(when, midLat, midLng);

      if (sun.altitude <= 0) {
        const night = nightSample();
        return { left: 1, right: 1, source: night.source, confidence: night.confidence };
      }

      const { left: leftOffset, right: rightOffset } = sidewalkOffsets(edge);
      const steps = edgeSampleCount(edgeLengthM(edge));

      // One point per sample, exactly where `sampleBothSidewalks` reads its pixel.
      const walk = (offset: [number, number]) => {
        if (!resolved) return { shade: 0, confidence: 0, source: "none" as ShadeSource };

        let sum = 0;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          sum += pointShade(
            resolved,
            edge.from[0] + t * (edge.to[0] - edge.from[0]) + offset[0],
            edge.from[1] + t * (edge.to[1] - edge.from[1]) + offset[1],
            sun.azimuth,
            sun.altitude
          );
        }

        const sample = sampleFor(resolved, sum / (steps + 1), sun.altitude);
        return { shade: sample.shade, confidence: sample.confidence, source: sample.source };
      };

      const left = walk(leftOffset);
      const right = walk(rightOffset);

      return {
        left: left.shade,
        right: right.shade,
        source: left.source,
        // The whole edge is only as trustworthy as its least-covered sidewalk.
        confidence: Math.min(left.confidence, right.confidence),
      };
    });
  }

  function sampleEdges(edges: EdgeRef[], when: Date): EdgeShade[] {
    const bbox = bboxAroundEdges(edges, QUERY_PAD_M);
    return sampleEdgesWithSun(edges, when, bbox ? resolve(bbox) : null);
  }

  return {
    shadeAt,
    sampleEdges,

    sweep(edges, times) {
      // Resolving geometry once across all times is the only saving here so far.
      // A6 replaces this with per-(prism, time) projections computed in one pass;
      // the results must stay identical to N separate `sampleEdges` calls.
      const bbox = bboxAroundEdges(edges, QUERY_PAD_M);
      const resolved = bbox ? resolve(bbox) : null;
      return times.map((when) => sampleEdgesWithSun(edges, when, resolved));
    },

    async ready(bbox) {
      await Promise.all(providers.map((provider) => provider.load?.(bbox)));
    },
  };
}

/** No geometry is consulted when the sun is down, and none is needed. */
function nightSample(): ShadeSample {
  return { shade: 1, source: "none", confidence: 1 };
}

/**
 * Perpendicular ±4 m offsets for an edge's left and right sidewalks.
 *
 * Deliberately mirrors `shadeSampling.sampleBothSidewalks` — the same offset, the
 * same 111195 m/deg constant, the same sign convention — so that the field and the
 * pixel sampler are looking at the same two lines and A3's disagreement number
 * measures the shade model rather than a difference in where each one stood.
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
 * Used by tests and by callers that already hold geometry (the agent's `check_shade`
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

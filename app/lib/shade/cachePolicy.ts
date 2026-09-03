/**
 * When the shadow renderer's building cache has to be rebuilt.
 *
 * `LocalShadowAdapter` caches building geometry because assembling it is the most
 * expensive routine in the app: `querySourceFeatures` over every visible tile, then
 * an earcut triangulation per roof ring. Historically the cache was thrown away on
 * `sourcedata`, `zoomend` and `moveend` alike — so a camera that settles often paid
 * that cost often, and a single pan paid it twice (the source finishes loading *and*
 * the move ends).
 *
 * The decision is a pure function of what the cache was built for and where the
 * camera is now, so it lives here rather than in the renderer: this module has no
 * WebGL, no worker and no MapLibre, which is what makes the rebuild count testable
 * in `environment: "node"` at all.
 *
 * The invariant this module exists to protect: **the cache may be stale in _extent_,
 * never in _content_.** A building inside the cached region must never be missing
 * from it. That is the line between "fewer rebuilds" and "wrong shadows".
 */

import { metersPerDegree } from "./geometry";

/**
 * How far the camera may travel before the captured feature set is considered stale.
 *
 * This is a judgement, not a derived figure — there is no render instrumentation in
 * the app to tune it against (see #146). It is one constant so it is tunable in one
 * place. Too large and buildings entering the viewport cast no shadow until the user
 * crosses the threshold; too small and the gate stops buying anything.
 */
export const CACHE_PAN_THRESHOLD_M = 150;

/**
 * Zoom drift tolerated before rebuilding. Zoom changes which tiles are loaded and
 * therefore which features `querySourceFeatures` returns, so this stays tight.
 */
export const CACHE_ZOOM_EPSILON = 0.5;

/**
 * Below this zoom `buildBuildingGeometryCache` returns an empty cache, because
 * MapTiler stops serving building geometry. Crossing it in either direction changes
 * the answer completely, so it is always a rebuild regardless of pan distance.
 */
export const MIN_BUILDING_ZOOM = 12;

/** What a cached build was made from. */
export interface CacheAnchor {
  centerLng: number;
  centerLat: number;
  zoom: number;
  /** Viewport bounds captured at build time, `[west, south, east, north]`. */
  bounds: [number, number, number, number];
  /**
   * Whether `maptiler_planet` had finished loading when this cache was built.
   *
   * The renderer builds lazily inside `render()`, which can fire while tiles are
   * still streaming. A cache built from a partial source must be replaced as soon as
   * the full set arrives — otherwise a camera-distance gate would hold the partial
   * geometry until the user travelled far enough to trip the threshold, which looks
   * exactly like the shadow renderer being broken.
   */
  builtFromLoadedSource: boolean;
}

/** Where the camera is now, and whether the tile source is settled. */
export interface CameraState {
  centerLng: number;
  centerLat: number;
  zoom: number;
  sourceLoaded: boolean;
}

/** Great-circle-free ground distance; adequate at the scale of a city block. */
function approxDistanceM(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number
): number {
  const { mPerLat, mPerLng } = metersPerDegree((aLat + bLat) / 2);
  const dx = (bLng - aLng) * mPerLng;
  const dy = (bLat - aLat) * mPerLat;
  return Math.hypot(dx, dy);
}

/**
 * Should the building cache be discarded and rebuilt?
 *
 * True when there is nothing cached, when the cache was built from a source that has
 * since finished loading, when the zoom moved materially or crossed the
 * building-geometry floor, or when the camera travelled further than
 * `CACHE_PAN_THRESHOLD_M`.
 */
export function shouldRebuildCache(
  anchor: CacheAnchor | null,
  camera: CameraState
): boolean {
  if (!anchor) return true;

  // Built mid-load, and the rest of the tiles have since arrived.
  if (!anchor.builtFromLoadedSource && camera.sourceLoaded) return true;

  // Crossing the floor flips the cache between "real geometry" and "empty", so a
  // pan-distance test can't speak for it.
  const wasBelow = anchor.zoom < MIN_BUILDING_ZOOM;
  const isBelow = camera.zoom < MIN_BUILDING_ZOOM;
  if (wasBelow !== isBelow) return true;

  if (Math.abs(camera.zoom - anchor.zoom) > CACHE_ZOOM_EPSILON) return true;

  return (
    approxDistanceM(
      anchor.centerLng,
      anchor.centerLat,
      camera.centerLng,
      camera.centerLat
    ) > CACHE_PAN_THRESHOLD_M
  );
}

/**
 * Does this cache actually hold buildings for `[lng, lat]`?
 *
 * `queryPointShade` used to gate on the *viewport's* bounds. Once cache extent and
 * viewport are allowed to diverge that guard checks the wrong region and will answer
 * a query for a point the cache has no buildings for — reporting open sun somewhere
 * it simply never looked. Callers ask this instead, and rebuild when it is false.
 */
export function coversPoint(
  anchor: CacheAnchor | null,
  lng: number,
  lat: number
): boolean {
  if (!anchor) return false;
  const [west, south, east, north] = anchor.bounds;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

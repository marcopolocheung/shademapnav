/**
 * Live `PrismProvider`s — the two real sources behind `ShadeField`.
 *
 * A2 published the provider contract and shipped only `staticPrismProvider`, which
 * is enough for tests and for callers already holding geometry. These are the ones
 * the app uses: MapTiler vector tiles (fast, synchronous, viewport-scoped) and
 * Overpass (slower, async, works anywhere). Order them tiles-first, so the network
 * path runs only where the renderer has nothing loaded.
 *
 * The contract's one hard rule is what makes both of these honest: `prismsFor`
 * returns `null` when the provider cannot speak for an area, never an empty set.
 * A tile provider asked about a bbox off-screen has no buildings *and no knowledge*,
 * and reporting the first without the second is how a route ends up confidently
 * promising shade that isn't there.
 */

import { type BuildingFootprint, fetchBuildingFootprintsAround } from "../overpass";
import type { BBox, PrismProvider } from "./ShadeField";
import { bboxContains } from "./ShadeField";
import {
  type BuildingFeatureLike,
  type PrismSet,
  metersPerDegree,
  prismsFromFootprints,
  prismsFromTileFeatures,
} from "./geometry";

// ─── Tiles ────────────────────────────────────────────────────────────────────

/** The slice of `maplibregl.Map` the tile provider needs. `Map` satisfies this structurally. */
export interface TileMapLike {
  getZoom(): number;
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
  querySourceFeatures(
    source: string,
    options: { sourceLayer: string }
  ): BuildingFeatureLike[];
}

/**
 * Below this zoom MapTiler stops serving individual building geometry, so a query
 * would return a thin, misleading subset. `LocalShadowAdapter` bails at the same
 * threshold and paints nothing.
 */
const MIN_BUILDING_ZOOM = 12;

/**
 * Above this zoom the tile source serves the building layer in full; below it, it
 * serves a decimated subset that gets thinner the further out you go.
 *
 * That gap is the dangerous one. `prismsFor` still returns a non-empty `PrismSet`,
 * so `confidenceFor`'s `dataFactor` — which only asks whether *any* prism came back
 * — sees buildings and docks nothing, and the field reports a confident, nearly
 * shadeless street. Measured in Chromium on the same Midtown route at the same time,
 * the reported shade fell from 83% at z16.3 to 53% at z14 and 9% at z13 purely
 * because of what the tile layer contained.
 */
const COMPLETE_BUILDING_ZOOM = 15;

/**
 * What a decimated tile answer is worth, as a multiplier on the tile prior.
 *
 * Chosen to put the result under `LOW_CONFIDENCE` (0.8 × 0.5 = 0.4), i.e. "do not
 * route on this — ask the other source". That is a deliberate policy, not a measured
 * quantity: this repo has no corpus that can price partial building coverage, and the
 * agreement harness cannot supply one because it compares the field and the pixel
 * sampler over *identical* prisms. Like `SOURCE_BASE_CONFIDENCE`, it is a prior that
 * a real corpus should replace.
 */
const DECIMATED_COMPLETENESS = 0.5;

const TILE_SOURCE = "maptiler_planet";
const TILE_LAYER = "building";

/**
 * Prisms from whatever the renderer currently has loaded.
 *
 * Synchronous and free of network, but it can only answer for the current viewport —
 * `querySourceFeatures` sees loaded tiles, not the world. That viewport dependence is
 * the very thing Track A exists to remove from routing, so this provider goes first
 * for speed and the Overpass one behind it for reach.
 *
 * The query and the prism assembly are cached against the map's current view, because
 * sampling a route asks for the same bbox once per edge and `querySourceFeatures` plus
 * earcut is the expensive half of a shade calculation.
 */
export function createTilePrismProvider(getMap: () => TileMapLike | null): PrismProvider {
  let cached: { key: string; set: PrismSet } | null = null;

  return {
    source: "tiles",

    completeness() {
      const map = getMap();
      if (!map) return 0;
      return map.getZoom() >= COMPLETE_BUILDING_ZOOM ? 1 : DECIMATED_COMPLETENESS;
    },

    prismsFor(bbox) {
      const map = getMap();
      if (!map) return null;

      const zoom = map.getZoom();
      if (zoom < MIN_BUILDING_ZOOM) return null;

      const bounds = map.getBounds();
      const loaded: BBox = {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      };
      // Off-screen means "I don't know", not "no buildings".
      if (!bboxContains(loaded, bbox)) return null;

      const key = [
        zoom.toFixed(3),
        loaded.west.toFixed(6),
        loaded.south.toFixed(6),
        loaded.east.toFixed(6),
        loaded.north.toFixed(6),
      ].join(",");

      if (cached?.key === key) return cached.set;

      const set = prismsFromTileFeatures(
        map.querySourceFeatures(TILE_SOURCE, { sourceLayer: TILE_LAYER })
      );
      cached = { key, set };
      return set;
    },
  };
}

// ─── Overpass ─────────────────────────────────────────────────────────────────

/**
 * The largest area one Overpass call may be asked for, as a radius in metres.
 *
 * `fetchBuildingFootprintsAround` gives Overpass a 10 s query timeout and aborts at
 * 12 s; a city-scale bbox blows through both and returns nothing useful. Rather than
 * issue a request that will fail, the provider declines the bbox — which is what
 * `null` means — and the caller falls back. A route longer than this needs the bbox
 * split, which belongs with A5's worker rather than here.
 */
const MAX_FETCH_RADIUS_M = 1500;

/** How many fetched areas to keep. Small on purpose — each holds every prism in ~3 km². */
const CACHE_ENTRIES = 4;

interface CacheEntry {
  coverage: BBox;
  set: PrismSet;
}

/** The half-diagonal of a bbox in metres — the radius that covers all of it. */
export function bboxRadiusM(bbox: BBox): number {
  const { mPerLat, mPerLng } = metersPerDegree((bbox.south + bbox.north) / 2);
  const halfWidthM = ((bbox.east - bbox.west) * mPerLng) / 2;
  const halfHeightM = ((bbox.north - bbox.south) * mPerLat) / 2;
  return Math.sqrt(halfWidthM * halfWidthM + halfHeightM * halfHeightM);
}

function centreOf(bbox: BBox): [number, number] {
  return [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2];
}

/** The bbox `fetchBuildingFootprintsAround` actually covers for a centre and radius. */
function coverageFor(lng: number, lat: number, radiusM: number): BBox {
  const { mPerLat, mPerLng } = metersPerDegree(lat);
  return {
    west: lng - radiusM / mPerLng,
    east: lng + radiusM / mPerLng,
    south: lat - radiusM / mPerLat,
    north: lat + radiusM / mPerLat,
  };
}

/**
 * Prisms from Overpass, for areas the renderer never loaded.
 *
 * Viewport-independent and therefore the whole point of the track — but it is a
 * network call against a shared, rate-limited public service, so it only ever runs
 * from `ready()`. `prismsFor` is synchronous by contract and answers from the cache
 * or declines; it must never be the thing that decides to hit the network, or
 * sampling one route would fire a request per edge.
 */
export function createOverpassPrismProvider(opts?: {
  fetchFootprints?: (
    lng: number,
    lat: number,
    radiusM: number,
    signal?: AbortSignal
  ) => Promise<BuildingFootprint[]>;
  maxFetchRadiusM?: number;
}): PrismProvider {
  const fetchFootprints = opts?.fetchFootprints ?? fetchBuildingFootprintsAround;
  const maxRadiusM = opts?.maxFetchRadiusM ?? MAX_FETCH_RADIUS_M;
  const cache: CacheEntry[] = [];
  const inFlight = new Map<string, Promise<void>>();

  function lookup(bbox: BBox): PrismSet | null {
    for (let i = 0; i < cache.length; i++) {
      if (bboxContains(cache[i].coverage, bbox)) {
        // Most-recently-used to the front, so the small cache keeps what a route uses.
        const [entry] = cache.splice(i, 1);
        cache.unshift(entry);
        return entry.set;
      }
    }
    return null;
  }

  return {
    source: "overpass",

    prismsFor(bbox) {
      return lookup(bbox);
    },

    async load(bbox) {
      if (lookup(bbox)) return;

      // Pad the request past the requested bbox: a shadow is cast by buildings
      // *outside* the area it falls on, and a fetch that stops at the bbox edge
      // reports a sunlit street beside an unseen tower.
      const radiusM = bboxRadiusM(bbox) * 1.25;
      if (radiusM > maxRadiusM) return;

      const [lng, lat] = centreOf(bbox);
      const key = `${lng.toFixed(5)},${lat.toFixed(5)},${Math.round(radiusM)}`;

      const existing = inFlight.get(key);
      if (existing) return existing;

      const pending = (async () => {
        try {
          const footprints = await fetchFootprints(lng, lat, radiusM);
          cache.unshift({
            coverage: coverageFor(lng, lat, radiusM),
            set: prismsFromFootprints(footprints),
          });
          if (cache.length > CACHE_ENTRIES) cache.length = CACHE_ENTRIES;
        } catch {
          // A failed fetch leaves nothing cached, so `prismsFor` keeps returning
          // null and the field reports confidence 0 — which is the honest answer
          // and the signal for the caller to fall back. Never cache the failure as
          // "no buildings here".
        } finally {
          inFlight.delete(key);
        }
      })();

      inFlight.set(key, pending);
      return pending;
    },
  };
}

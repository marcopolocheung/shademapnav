import { describe, expect, it } from "vitest";
import {
  CACHE_PAN_THRESHOLD_M,
  type CacheAnchor,
  type CameraState,
  coversPoint,
  MIN_BUILDING_ZOOM,
  shouldRebuildCache,
} from "../cachePolicy";

/** Madrid — same latitude the geometry fixtures use, where lng/lat metre scales differ. */
const LAT = 40.4168;
const LNG = -3.7038;

/** Metres → degrees at LAT, so pans can be written in metres. */
const M_PER_LAT = 111320;
const M_PER_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);

function anchor(over: Partial<CacheAnchor> = {}): CacheAnchor {
  return {
    centerLng: LNG,
    centerLat: LAT,
    zoom: 16,
    bounds: [LNG - 0.01, LAT - 0.01, LNG + 0.01, LAT + 0.01],
    builtFromLoadedSource: true,
    ...over,
  };
}

function camera(over: Partial<CameraState> = {}): CameraState {
  return { centerLng: LNG, centerLat: LAT, zoom: 16, sourceLoaded: true, ...over };
}

/** A camera panned `metres` due east of the anchor. */
function pannedEast(metres: number): CameraState {
  return camera({ centerLng: LNG + metres / M_PER_LNG });
}

/** A camera panned `metres` due north — catches lng/lat axis confusion. */
function pannedNorth(metres: number): CameraState {
  return camera({ centerLat: LAT + metres / M_PER_LAT });
}

/**
 * Replays a camera path and counts rebuilds, the way the renderer would: a rebuild
 * re-anchors the cache to wherever the camera was at that moment.
 */
function countRebuilds(path: CameraState[]): number {
  let current: CacheAnchor | null = null;
  let rebuilds = 0;
  for (const c of path) {
    if (shouldRebuildCache(current, c)) {
      rebuilds++;
      current = {
        centerLng: c.centerLng,
        centerLat: c.centerLat,
        zoom: c.zoom,
        bounds: [c.centerLng - 0.01, c.centerLat - 0.01, c.centerLng + 0.01, c.centerLat + 0.01],
        builtFromLoadedSource: c.sourceLoaded,
      };
    }
  }
  return rebuilds;
}

describe("shouldRebuildCache", () => {
  it("builds when nothing is cached", () => {
    expect(shouldRebuildCache(null, camera())).toBe(true);
  });

  it("holds the cache while the camera stays put", () => {
    expect(shouldRebuildCache(anchor(), camera())).toBe(false);
  });

  it("holds through small pans and rebuilds once past the threshold", () => {
    expect(shouldRebuildCache(anchor(), pannedEast(CACHE_PAN_THRESHOLD_M * 0.5))).toBe(false);
    expect(shouldRebuildCache(anchor(), pannedEast(CACHE_PAN_THRESHOLD_M * 2))).toBe(true);
  });

  it("measures pan distance the same way on both axes", () => {
    // A naive implementation that treats degrees as isotropic gets this wrong at lat 40,
    // where a degree of longitude is ~24% shorter than a degree of latitude.
    const far = CACHE_PAN_THRESHOLD_M * 2;
    expect(shouldRebuildCache(anchor(), pannedEast(far))).toBe(true);
    expect(shouldRebuildCache(anchor(), pannedNorth(far))).toBe(true);
    const near = CACHE_PAN_THRESHOLD_M * 0.5;
    expect(shouldRebuildCache(anchor(), pannedEast(near))).toBe(false);
    expect(shouldRebuildCache(anchor(), pannedNorth(near))).toBe(false);
  });

  it("rebuilds on a material zoom change but not on scroll jitter", () => {
    expect(shouldRebuildCache(anchor(), camera({ zoom: 16.1 }))).toBe(false);
    expect(shouldRebuildCache(anchor(), camera({ zoom: 18 }))).toBe(true);
  });

  it("always rebuilds when the building-geometry floor is crossed", () => {
    const below = MIN_BUILDING_ZOOM - 1;
    const above = MIN_BUILDING_ZOOM + 1;
    // Both directions, and despite the camera not having moved at all.
    expect(shouldRebuildCache(anchor({ zoom: above }), camera({ zoom: below }))).toBe(true);
    expect(shouldRebuildCache(anchor({ zoom: below }), camera({ zoom: above }))).toBe(true);
  });

  it("replaces a cache built from a still-loading source, exactly once", () => {
    const partial = anchor({ builtFromLoadedSource: false });
    expect(shouldRebuildCache(partial, camera({ sourceLoaded: true }))).toBe(true);
    // Once rebuilt from the settled source, a further sourcedata event changes nothing.
    expect(shouldRebuildCache(anchor(), camera({ sourceLoaded: true }))).toBe(false);
  });

  it("does not rebuild a partial cache while the source is still loading", () => {
    const partial = anchor({ builtFromLoadedSource: false });
    expect(shouldRebuildCache(partial, camera({ sourceLoaded: false }))).toBe(false);
  });
});

describe("rebuild count over a camera path", () => {
  it("charges one build for a walk that stays inside the threshold", () => {
    // 20 settles over 100 m total — a person walking a block while the camera follows.
    const step = 100 / 20;
    const path = Array.from({ length: 20 }, (_, i) => pannedEast(step * (i + 1)));
    expect(countRebuilds(path)).toBe(1);
  });

  it("charges one build per threshold crossed, not one per settle", () => {
    // 60 settles of 10 m each, 600 m total. Each rebuild re-anchors to the camera's
    // position at that moment, so crossings compound rather than falling on multiples
    // of 150: build at 10 m, then at 170, 330 and 490 — four, not sixty.
    const step = 600 / 60;
    const path = Array.from({ length: 60 }, (_, i) => pannedEast(step * (i + 1)));
    const rebuilds = countRebuilds(path);
    expect(rebuilds).toBe(4);
    // Anti-vacuous: a policy that always rebuilds would score 60 and must fail here.
    expect(rebuilds).toBeLessThan(path.length);
  });

  it("collapses the double rebuild a single pan used to cost", () => {
    // One pan raises both `sourcedata` (source settled) and `moveend` at the same
    // camera position. Before the gate that was two full rebuilds.
    const dest = pannedEast(CACHE_PAN_THRESHOLD_M * 2);
    expect(countRebuilds([dest, dest])).toBe(1);
  });
});

describe("coversPoint", () => {
  const a = anchor();

  it("is false without a cache", () => {
    expect(coversPoint(null, LNG, LAT)).toBe(false);
  });

  it("accepts a point inside the captured bounds", () => {
    expect(coversPoint(a, LNG, LAT)).toBe(true);
  });

  it("rejects a point the cache never looked at", () => {
    // Inside a viewport that has panned away, but outside what the cache holds — the
    // exact case that would otherwise report open sun for unexamined ground.
    expect(coversPoint(a, LNG + 0.05, LAT)).toBe(false);
    expect(coversPoint(a, LNG, LAT + 0.05)).toBe(false);
  });

  it("includes the boundary", () => {
    const [west, south, east, north] = a.bounds;
    expect(coversPoint(a, west, LAT)).toBe(true);
    expect(coversPoint(a, east, LAT)).toBe(true);
    expect(coversPoint(a, LNG, south)).toBe(true);
    expect(coversPoint(a, LNG, north)).toBe(true);
  });
});

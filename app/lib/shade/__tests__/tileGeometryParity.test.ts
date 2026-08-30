/**
 * Parity guard for the A1 extraction.
 *
 * `geometry.ts` was lifted out of `LocalShadowAdapter.buildBuildingGeometryCache()`
 * and `offscreenShade.ts`, and the whole point of that move was that nothing about
 * the rendered shadow changes. This file keeps the pre-refactor implementation
 * around as a reference and asserts the extracted module reproduces it
 * vertex-for-vertex over a pseudo-random corpus of buildings and sun positions —
 * a stronger claim than "the screenshots look the same", and one CI can hold.
 *
 * Delete it once `ShadeField` (A2) owns the geometry contract outright and the
 * pixel path is no longer the reference.
 */

import earcut from "earcut";
import { describe, expect, it } from "vitest";
import {
  type BuildingFeatureLike,
  buildShadowTriangles,
  pointInPrismShadow,
  prismsFromTileFeatures,
  triangulateRing,
} from "../geometry";

// ─── Pre-refactor implementation, copied from main ────────────────────────────

interface RefCache {
  buildings: Array<{
    heightM: number;
    normalizedH: number;
    rings: Array<{ coords: [number, number][]; mercatorRoofVerts: Float32Array }>;
  }>;
  maxH: number;
  centerMerc: [number, number];
}

function refHeightMFor(props: Record<string, unknown> | null | undefined): number {
  if (!props) return 3.1;
  const rh = Number(props.render_height);
  if (Number.isFinite(rh) && rh > 0) return rh;
  const h = Number(props.height);
  if (Number.isFinite(h) && h > 0) return h;
  const lv = Number(props["building:levels"]);
  if (Number.isFinite(lv) && lv > 0) return lv * 3.1;
  return 3.1;
}

function refLngLatToMercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return [x, y];
}

function refBuildCache(features: BuildingFeatureLike[], cx: number, cy: number): RefCache {
  const TALL_THRESHOLD = 100;

  const rawBuildings = features.filter((f) => f.properties && f.properties.underground !== "true");
  const buildings = rawBuildings.filter((b) => {
    if (refHeightMFor(b.properties) > TALL_THRESHOLD && b.properties?.hide_3d) return false;
    return true;
  });

  buildings.sort((a, b) => refHeightMFor(a.properties) - refHeightMFor(b.properties));

  let maxH = 0;
  for (const b of buildings) {
    const h = refHeightMFor(b.properties);
    if (h > maxH) maxH = h;
  }
  if (maxH === 0) maxH = 1;

  const cached: RefCache = { buildings: [], maxH, centerMerc: [cx, cy] };

  for (const b of buildings) {
    if (b.geometry.type !== "Polygon" && b.geometry.type !== "MultiPolygon") continue;
    const heightM = refHeightMFor(b.properties);
    const normalizedH = heightM / maxH;

    const rawRings =
      b.geometry.type === "Polygon"
        ? (b.geometry.coordinates as [number, number][][])
        : (b.geometry.coordinates as [number, number][][][]).flat(1);

    const cachedRings: RefCache["buildings"][number]["rings"] = [];

    for (const ring of rawRings) {
      const coords = ring;
      const flatCoords: number[] = [];
      for (const [lng, lat] of coords) flatCoords.push(lng, lat);
      const indices = earcut(flatCoords, [], 2);
      const roofVerts: number[] = [];
      for (let i = 0; i < indices.length; i += 3) {
        const ai = indices[i];
        const bi = indices[i + 1];
        const ci = indices[i + 2];
        const [x0, y0] = refLngLatToMercator(flatCoords[ai * 2], flatCoords[ai * 2 + 1]);
        const [x1, y1] = refLngLatToMercator(flatCoords[bi * 2], flatCoords[bi * 2 + 1]);
        const [x2, y2] = refLngLatToMercator(flatCoords[ci * 2], flatCoords[ci * 2 + 1]);
        roofVerts.push(x0 - cx, y0 - cy, x1 - cx, y1 - cy, x2 - cx, y2 - cy);
      }

      cachedRings.push({ coords, mercatorRoofVerts: new Float32Array(roofVerts) });
    }

    cached.buildings.push({ heightM, normalizedH, rings: cachedRings });
  }

  return cached;
}

function refBuildShadowTriangles(
  ring: [number, number][],
  heightM: number,
  azimuth: number,
  altitude: number,
  mPerLat: number,
  mPerLng: number
): [number, number][] {
  const shadowLengthM = heightM / Math.tan(altitude);
  const dLat = (Math.cos(azimuth) * shadowLengthM) / mPerLat;
  const dLng = (Math.sin(azimuth) * shadowLengthM) / mPerLng;

  let pts = ring;
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return [];

  const shifted = pts.map(([lng, lat]) => [lng + dLng, lat + dLat] as [number, number]);
  const out: [number, number][] = [];

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    out.push(pts[i], pts[j], shifted[i]);
    out.push(pts[j], shifted[j], shifted[i]);
  }

  const flatOrig: number[] = [];
  for (const [lng, lat] of pts) flatOrig.push(lng, lat);
  const origIdx = earcut(flatOrig, [], 2);
  for (let i = 0; i < origIdx.length; i += 3) {
    out.push(pts[origIdx[i]], pts[origIdx[i + 1]], pts[origIdx[i + 2]]);
  }

  const flatShifted: number[] = [];
  for (const [lng, lat] of shifted) flatShifted.push(lng, lat);
  const shiftIdx = earcut(flatShifted, [], 2);
  for (let i = 0; i < shiftIdx.length; i += 3) {
    out.push(shifted[shiftIdx[i]], shifted[shiftIdx[i + 1]], shifted[shiftIdx[i + 2]]);
  }

  return out;
}

function refPointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-20) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function refPointInTriangle(
  lng: number,
  lat: number,
  a: [number, number],
  b: [number, number],
  c: [number, number]
): boolean {
  const v0x = c[0] - a[0];
  const v0y = c[1] - a[1];
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = lng - a[0];
  const v2y = lat - a[1];

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-20) return false;

  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function refPointInCachedShadow(
  cache: RefCache,
  lng: number,
  lat: number,
  azimuth: number,
  altitude: number,
  mPerLat: number,
  mPerLng: number
): boolean {
  for (const bldg of cache.buildings) {
    for (const ring of bldg.rings) {
      if (refPointInPolygon(lng, lat, ring.coords)) return false;
    }
  }

  for (const bldg of cache.buildings) {
    for (const ring of bldg.rings) {
      const tris = refBuildShadowTriangles(
        ring.coords,
        bldg.heightM,
        azimuth,
        altitude,
        mPerLat,
        mPerLng
      );
      for (let i = 0; i < tris.length; i += 3) {
        if (refPointInTriangle(lng, lat, tris[i], tris[i + 1], tris[i + 2])) return true;
      }
    }
  }

  return false;
}

// ─── Corpus ───────────────────────────────────────────────────────────────────

/** mulberry32 — a small deterministic PRNG so the corpus is identical every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITY_LAT = 40.4168;
const CITY_LNG = -3.7038;
const M_PER_LAT = 111320;
const M_PER_LNG = 111320 * Math.cos((CITY_LAT * Math.PI) / 180);

/** A block of buildings with mixed heights, tags, ring winding, and geometry types. */
function corpus(seed: number): BuildingFeatureLike[] {
  const rand = rng(seed);
  const features: BuildingFeatureLike[] = [];

  for (let i = 0; i < 24; i++) {
    const eastM = (rand() - 0.5) * 400;
    const northM = (rand() - 0.5) * 400;
    const widthM = 8 + rand() * 40;
    const depthM = 8 + rand() * 40;
    const cLng = CITY_LNG + eastM / M_PER_LNG;
    const cLat = CITY_LAT + northM / M_PER_LAT;
    const dLng = widthM / 2 / M_PER_LNG;
    const dLat = depthM / 2 / M_PER_LAT;

    // Alternate between a rectangle and an L-shape so concave handling is exercised.
    const ring: [number, number][] =
      i % 3 === 0
        ? [
            [cLng - dLng, cLat - dLat],
            [cLng + dLng, cLat - dLat],
            [cLng + dLng, cLat],
            [cLng, cLat],
            [cLng, cLat + dLat],
            [cLng - dLng, cLat + dLat],
            [cLng - dLng, cLat - dLat],
          ]
        : [
            [cLng - dLng, cLat - dLat],
            [cLng + dLng, cLat - dLat],
            [cLng + dLng, cLat + dLat],
            [cLng - dLng, cLat + dLat],
            [cLng - dLng, cLat - dLat],
          ];

    const roll = rand();
    const properties: Record<string, unknown> =
      roll < 0.25
        ? { render_height: 4 + rand() * 160, hide_3d: roll < 0.08 }
        : roll < 0.5
          ? { height: 4 + rand() * 60 }
          : roll < 0.75
            ? { "building:levels": Math.ceil(rand() * 12) }
            : { underground: rand() < 0.3 ? "true" : "false" };

    features.push(
      i % 7 === 0
        ? { properties, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } }
        : { properties, geometry: { type: "Polygon", coordinates: [ring] } }
    );
  }

  // Non-polygonal noise, which the pipeline must skip while still counting height.
  features.push({
    properties: { render_height: 55 },
    geometry: { type: "LineString", coordinates: [[CITY_LNG, CITY_LAT]] },
  });

  return features;
}

/** Sun positions spanning a day: low east, high south, low west. */
const SUN_POSITIONS: Array<{ azimuth: number; altitude: number }> = [
  { azimuth: -1.9, altitude: 0.12 },
  { azimuth: -1.0, altitude: 0.55 },
  { azimuth: 0, altitude: 1.15 },
  { azimuth: 0.9, altitude: 0.6 },
  { azimuth: 1.85, altitude: 0.1 },
];

// ─── The parity assertions ────────────────────────────────────────────────────

describe("A1 extraction parity", () => {
  const seeds = [1, 7, 42, 1337];

  it("enumerates the same rings, in the same order, with the same heights", () => {
    for (const seed of seeds) {
      const features = corpus(seed);
      const reference = refBuildCache(features, 0, 0);
      const { prisms, maxHeightM } = prismsFromTileFeatures(features);

      const refRings = reference.buildings.flatMap((b) =>
        b.rings.map((r) => ({ ring: r.coords, heightM: b.heightM }))
      );

      expect(prisms).toEqual(refRings);
      expect(maxHeightM).toBe(reference.maxH);
    }
  });

  it("produces identical roof triangulations", () => {
    for (const seed of seeds) {
      const features = corpus(seed);
      const reference = refBuildCache(features, 0, 0);
      const { prisms } = prismsFromTileFeatures(features);

      const refRoofs = reference.buildings.flatMap((b) => b.rings.map((r) => r.mercatorRoofVerts));
      const newRoofs = prisms.map((p) => {
        const verts: number[] = [];
        for (const [lng, lat] of triangulateRing(p.ring)) {
          const [x, y] = refLngLatToMercator(lng, lat);
          verts.push(x, y);
        }
        return new Float32Array(verts);
      });

      expect(newRoofs).toEqual(refRoofs);
    }
  });

  it("produces identical shadow triangles at every sun position", () => {
    for (const seed of seeds) {
      const features = corpus(seed);
      const reference = refBuildCache(features, 0, 0);
      const { prisms } = prismsFromTileFeatures(features);

      for (const sun of SUN_POSITIONS) {
        const refTris = reference.buildings.flatMap((b) =>
          b.rings.flatMap((r) =>
            refBuildShadowTriangles(r.coords, b.heightM, sun.azimuth, sun.altitude, M_PER_LAT, M_PER_LNG)
          )
        );
        const newTris = prisms.flatMap((p) =>
          buildShadowTriangles(p.ring, p.heightM, sun.azimuth, sun.altitude, M_PER_LAT, M_PER_LNG)
        );

        expect(newTris).toEqual(refTris);
      }
    }
  });

  it("answers point queries identically across a sampling grid", () => {
    const features = corpus(42);
    const reference = refBuildCache(features, 0, 0);
    const { prisms } = prismsFromTileFeatures(features);

    let shadedCount = 0;
    let compared = 0;

    for (const sun of SUN_POSITIONS) {
      for (let gx = -8; gx <= 8; gx++) {
        for (let gy = -8; gy <= 8; gy++) {
          const lng = CITY_LNG + (gx * 25) / M_PER_LNG;
          const lat = CITY_LAT + (gy * 25) / M_PER_LAT;

          const before = refPointInCachedShadow(
            reference, lng, lat, sun.azimuth, sun.altitude, M_PER_LAT, M_PER_LNG
          );
          const after = pointInPrismShadow(
            prisms, lng, lat, sun.azimuth, sun.altitude, M_PER_LAT, M_PER_LNG
          );

          expect(after).toBe(before);
          compared++;
          if (after) shadedCount++;
        }
      }
    }

    // Guard against a vacuous pass: the corpus must actually cast shade somewhere.
    expect(compared).toBe(SUN_POSITIONS.length * 17 * 17);
    expect(shadedCount).toBeGreaterThan(50);
  });
});

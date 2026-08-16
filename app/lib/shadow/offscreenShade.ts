import SunCalc from "suncalc";
import earcut from "earcut";
import { fetchBuildingFootprintsAround, type BuildingFootprint } from "../overpass";

export interface OffscreenShadeResult {
  shadeFraction: number;
  source: "overpass-buildings";
  buildingCount: number;
}

export async function queryOffscreenBuildingShade(
  lng: number,
  lat: number,
  date: Date,
  signal?: AbortSignal
): Promise<OffscreenShadeResult> {
  const buildings = await fetchBuildingFootprintsAround(lng, lat, 180, signal);
  return {
    shadeFraction: computeBuildingShadeFraction(lng, lat, date, buildings),
    source: "overpass-buildings",
    buildingCount: buildings.length,
  };
}

export function computeBuildingShadeFraction(
  lng: number,
  lat: number,
  date: Date,
  buildings: BuildingFootprint[]
): number {
  const sun = SunCalc.getPosition(date, lat, lng);
  if (sun.altitude <= 0) return 1;

  const mPerLat = 111320;
  const mPerLng = Math.max(1e-6, 111320 * Math.cos(lat * Math.PI / 180));
  const offsetsM: Array<[number, number]> = [
    [0, 0],
    [-4, 0],
    [4, 0],
    [0, -4],
    [0, 4],
  ];

  let shaded = 0;
  for (const [dxM, dyM] of offsetsM) {
    const sampleLng = lng + dxM / mPerLng;
    const sampleLat = lat + dyM / mPerLat;
    if (pointInBuildingShadow(buildings, sampleLng, sampleLat, sun.azimuth, sun.altitude, mPerLat, mPerLng)) {
      shaded++;
    }
  }

  return shaded / offsetsM.length;
}

function pointInBuildingShadow(
  buildings: BuildingFootprint[],
  lng: number,
  lat: number,
  sunAzimuth: number,
  sunAltitude: number,
  mPerLat: number,
  mPerLng: number
): boolean {
  for (const building of buildings) {
    for (const ring of building.rings) {
      if (pointInPolygon(lng, lat, ring)) return false;
    }
  }

  for (const building of buildings) {
    for (const ring of building.rings) {
      const shadowTris = buildShadowTriangles(ring, building.heightM, sunAzimuth, sunAltitude, mPerLat, mPerLng);
      if (pointInTriangles(lng, lat, shadowTris)) return true;
    }
  }

  return false;
}

function buildShadowTriangles(
  ring: [number, number][],
  heightM: number,
  azimuth: number,
  altitude: number,
  mPerLat: number,
  mPerLng: number
): [number, number][] {
  const shadowLengthM = heightM / Math.tan(altitude);
  const dLat = Math.cos(azimuth) * shadowLengthM / mPerLat;
  const dLng = Math.sin(azimuth) * shadowLengthM / mPerLng;

  let pts = ring;
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return [];

  const shifted = pts.map(([pointLng, pointLat]) => [pointLng + dLng, pointLat + dLat] as [number, number]);
  const out: [number, number][] = [];

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const a = pts[i], b = pts[j];
    const sa = shifted[i], sb = shifted[j];
    out.push(a, b, sa);
    out.push(b, sb, sa);
  }

  out.push(...triangulateRing(pts));
  out.push(...triangulateRing(shifted));
  return out;
}

function triangulateRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return [];

  const flat: number[] = [];
  for (const [lng, lat] of ring) flat.push(lng, lat);
  const indices = earcut(flat);
  const out: [number, number][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    out.push(ring[indices[i]], ring[indices[i + 1]], ring[indices[i + 2]]);
  }
  return out;
}

function pointInTriangles(lng: number, lat: number, tris: [number, number][]): boolean {
  for (let i = 0; i < tris.length; i += 3) {
    if (pointInTriangle(lng, lat, tris[i], tris[i + 1], tris[i + 2])) return true;
  }
  return false;
}

function pointInTriangle(
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

function pointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-20) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

import SunCalc from "suncalc";
import { fetchBuildingFootprintsAround, type BuildingFootprint } from "../overpass";
import { metersPerDegree, prismsFromFootprints } from "../shade/geometry";
import { buildShadowIndex } from "../shade/shadowIndex";

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

  const { prisms } = prismsFromFootprints(buildings);
  const { mPerLat, mPerLng } = metersPerDegree(lat);
  const offsetsM: Array<[number, number]> = [
    [0, 0],
    [-4, 0],
    [4, 0],
    [0, -4],
    [0, 4],
  ];

  // One build for all five offsets. They already shared this sun and this projection
  // frame, so these are the same shadows the per-query path rebuilt five times over.
  const shadows = buildShadowIndex(prisms, sun.azimuth, sun.altitude, mPerLat, mPerLng, null);

  let shaded = 0;
  for (const [dxM, dyM] of offsetsM) {
    const sampleLng = lng + dxM / mPerLng;
    const sampleLat = lat + dyM / mPerLat;
    if (shadows.isShaded(sampleLng, sampleLat)) {
      shaded++;
    }
  }

  return shaded / offsetsM.length;
}

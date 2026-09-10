import SunCalc from "suncalc";
import { fetchBuildingFootprintsAround, type BuildingFootprint } from "../overpass";
import { metersPerDegree, prismsFromFootprints } from "../shadowField/geometry";
import { buildShadowIndex } from "../shadowField/shadowIndex";

export interface OffscreenShadowResult {
  shadowFraction: number;
  source: "overpass-buildings";
  buildingCount: number;
}

export async function queryOffscreenBuildingShadow(
  lng: number,
  lat: number,
  date: Date,
  signal?: AbortSignal
): Promise<OffscreenShadowResult> {
  const buildings = await fetchBuildingFootprintsAround(lng, lat, 180, signal);
  return {
    shadowFraction: computeBuildingShadowFraction(lng, lat, date, buildings),
    source: "overpass-buildings",
    buildingCount: buildings.length,
  };
}

export function computeBuildingShadowFraction(
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

  let shadowed = 0;
  for (const [dxM, dyM] of offsetsM) {
    const sampleLng = lng + dxM / mPerLng;
    const sampleLat = lat + dyM / mPerLat;
    if (shadows.isShadowed(sampleLng, sampleLat)) {
      shadowed++;
    }
  }

  return shadowed / offsetsM.length;
}

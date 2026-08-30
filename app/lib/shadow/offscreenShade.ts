import SunCalc from "suncalc";
import { fetchBuildingFootprintsAround, type BuildingFootprint } from "../overpass";
import { metersPerDegree, pointInPrismShadow, prismsFromFootprints } from "../shade/geometry";

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

  let shaded = 0;
  for (const [dxM, dyM] of offsetsM) {
    const sampleLng = lng + dxM / mPerLng;
    const sampleLat = lat + dyM / mPerLat;
    if (pointInPrismShadow(prisms, sampleLng, sampleLat, sun.azimuth, sun.altitude, mPerLat, mPerLng)) {
      shaded++;
    }
  }

  return shaded / offsetsM.length;
}

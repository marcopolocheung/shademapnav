import type { RouteLeg, RouteOption } from "./routing";

export type RouteBounds = [[number, number], [number, number]];

function collectLineStringCoordinates(
  feature: GeoJSON.Feature<GeoJSON.LineString>,
): [number, number][] {
  return feature.geometry.coordinates.filter(
    (coord): coord is [number, number] =>
      coord.length >= 2 && Number.isFinite(coord[0]) && Number.isFinite(coord[1]),
  );
}

function collectLegCoordinates(legs: RouteLeg[]): [number, number][] {
  return legs.flatMap((leg) => collectLineStringCoordinates(leg.geojson));
}

export function routeBounds(route: RouteOption): RouteBounds | null {
  const coords = route.legs?.length
    ? collectLegCoordinates(route.legs)
    : collectLineStringCoordinates(route.geojson);

  if (coords.length === 0) return null;

  let west = coords[0][0];
  let east = coords[0][0];
  let south = coords[0][1];
  let north = coords[0][1];

  for (const [lng, lat] of coords.slice(1)) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  return [
    [west, south],
    [east, north],
  ];
}

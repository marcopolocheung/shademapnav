/**
 * A synthetic Overpass `out body geom` response: an 11×11 street grid over
 * midtown Manhattan, in the exact shape `fetchRoutingGraph` parses (way
 * elements with `nodes`, inline `geometry`, and `tags.highway`).
 *
 * The smoke test stubs Overpass with this rather than hitting the real API:
 * the public instance rate-limits, times out under load, and returns a
 * different graph every month. The road graph only has to exist and connect the
 * two waypoints; the buildings it is routed among come from `basemapStyle.ts`
 * (or, in the `smoke-live` project, from real MapTiler tiles).
 */

const SOUTH = 40.7515;
const WEST = -73.9875;
const LAT_STEP = 0.0005; // ~55 m
const LNG_STEP = 0.0007; // ~59 m at this latitude
const ROWS = 11;
const COLS = 11;

interface OverpassGeom {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  geometry: OverpassGeom[];
  tags: { highway: string };
}

const nodeId = (row: number, col: number) => 1_000_000 + row * 100 + col;
const lat = (row: number) => Number((SOUTH + row * LAT_STEP).toFixed(6));
const lon = (col: number) => Number((WEST + col * LNG_STEP).toFixed(6));

function buildGrid(): OverpassWay[] {
  const ways: OverpassWay[] = [];

  for (let row = 0; row < ROWS; row++) {
    ways.push({
      type: "way",
      id: 100 + row,
      nodes: Array.from({ length: COLS }, (_, col) => nodeId(row, col)),
      geometry: Array.from({ length: COLS }, (_, col) => ({ lat: lat(row), lon: lon(col) })),
      tags: { highway: "residential" },
    });
  }

  for (let col = 0; col < COLS; col++) {
    ways.push({
      type: "way",
      id: 200 + col,
      nodes: Array.from({ length: ROWS }, (_, row) => nodeId(row, col)),
      geometry: Array.from({ length: ROWS }, (_, row) => ({ lat: lat(row), lon: lon(col) })),
      tags: { highway: "footway" },
    });
  }

  return ways;
}

export const overpassGridResponse = JSON.stringify({ elements: buildGrid() });

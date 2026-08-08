import { describe, expect, it } from "vitest";
import type { RouteOption } from "../routing";
import { routeTradeoffLine, shortestRoute } from "../routeTradeoff";

function route(label: string, distanceM: number, shadeCoverage: number, totalTimeSec?: number): RouteOption {
  return {
    label,
    distanceM,
    shadeCoverage,
    totalTimeSec,
    geojson: {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [] },
    },
    longestContinuousShadeM: 0,
    shadeTransitions: 0,
    detourRatio: 1,
    turnCount: 0,
  };
}

describe("routeTradeoffLine", () => {
  it("labels the shortest route as the comparison baseline", () => {
    const shortest = route("Shortest", 1000, 0.25);

    expect(routeTradeoffLine(shortest, shortest)).toBe("Shortest baseline, 25% shade");
  });

  it("reports added time and reduced sun exposure", () => {
    const shortest = route("Shortest", 1000, 0.2);
    const shaded = route("Most shaded", 1260, 0.62);

    expect(routeTradeoffLine(shaded, shortest)).toBe("+3 min, -40% sun exposure");
  });

  it("uses total travel time when a route has transit timing", () => {
    const walk = route("Walk", 1400, 0.5, 1000);
    const transit = route("Transit", 900, 0.16, 1120);

    expect(shortestRoute([walk, transit])).toBe(walk);
    expect(routeTradeoffLine(transit, walk)).toBe("+2 min, +8% sun exposure");
  });
});

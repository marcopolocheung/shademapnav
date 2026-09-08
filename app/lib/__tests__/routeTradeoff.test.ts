import { describe, expect, it } from "vitest";
import type { RouteOption } from "../routing";
import {
  routeExposureLine,
  routeExposureMinutes,
  routeTradeoffLine,
  shortestRoute,
} from "../routeTradeoff";

function route(
  label: string,
  distanceM: number,
  shadeCoverage: number,
  totalTimeSec?: number,
  longestContinuousSunM = 0,
): RouteOption {
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
    longestContinuousSunM,
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

describe("routeExposureLine", () => {
  it("states direct sun as minutes rather than a percentage", () => {
    // 1000 m at 20% sun = 200 m at 1.4 m/s ≈ 2.4 min
    expect(routeExposureLine(route("Shortest", 1000, 0.8))).toBe("2 min in sun");
  });

  it("adds the longest unbroken stretch when the route was sampled per edge", () => {
    // 2000 m at 30% sun = 600 m ≈ 7.1 min; longest run 420 m = 5 min
    expect(routeExposureLine(route("Balanced", 2000, 0.7, undefined, 420))).toBe(
      "7 min in sun · longest stretch 5 min",
    );
  });

  it("distinguishes routes a shade percentage would call equivalent", () => {
    // Same total sun, split six ways versus taken in one crossing.
    const scattered = route("Scattered", 2000, 0.7, undefined, 100);
    const oneCrossing = route("One crossing", 2000, 0.7, undefined, 600);

    expect(routeExposureLine(scattered)).toBe("7 min in sun · longest stretch 1 min");
    expect(routeExposureLine(oneCrossing)).toBe("7 min in sun · longest stretch 7 min");
  });

  it("omits the stretch for sketch and transit routes, whose streak is a placeholder", () => {
    expect(routeExposureLine(route("Via MRT", 1200, 0.4))).toBe("9 min in sun");
  });

  it("does not round a short exposure down to zero", () => {
    expect(routeExposureLine(route("Most shaded", 1000, 0.98))).toBe("under a minute in sun");
  });
});

describe("routeExposureMinutes", () => {
  it("splits the trip into sunlit and shaded minutes at walking pace", () => {
    // 840 m at 1.4 m/s is 10 minutes; 25% shade leaves 7.5 of them in the sun.
    const { sunMinutes, shadeMinutes } = routeExposureMinutes(route("Shortest", 840, 0.25));

    expect(sunMinutes).toBeCloseTo(7.5, 10);
    expect(shadeMinutes).toBeCloseTo(2.5, 10);
  });

  it("reports shaded minutes rather than dropping them", () => {
    // A fully shaded route is not a zero-exposure route: the UV model still charges
    // it for diffuse sky, and the heat model still has to know how long it lasts.
    const { sunMinutes, shadeMinutes } = routeExposureMinutes(route("Most shaded", 840, 1));

    expect(sunMinutes).toBe(0);
    expect(shadeMinutes).toBeCloseTo(10, 10);
  });

  it("never returns a negative half", () => {
    const { sunMinutes, shadeMinutes } = routeExposureMinutes(route("Odd", 840, 1.4));

    expect(sunMinutes).toBeGreaterThanOrEqual(0);
    expect(shadeMinutes).toBeGreaterThanOrEqual(0);
  });
});

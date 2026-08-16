import { describe, expect, it } from "vitest";
import type { RouteOption } from "../routing";
import { routeBounds } from "../routeBounds";

function line(coordinates: number[][]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}

function route(geojson: GeoJSON.Feature<GeoJSON.LineString>): RouteOption {
  return {
    label: "Shortest",
    geojson,
    distanceM: 100,
    shadeCoverage: 0.5,
    longestContinuousShadeM: 0,
    shadeTransitions: 0,
    detourRatio: 1,
    turnCount: 0,
  };
}

describe("routeBounds", () => {
  it("returns the southwest and northeast corners for a walking route", () => {
    expect(
      routeBounds(
        route(
          line([
            [103.8, 1.3],
            [103.82, 1.29],
            [103.81, 1.31],
          ]),
        ),
      ),
    ).toEqual([
      [103.8, 1.29],
      [103.82, 1.31],
    ]);
  });

  it("uses all leg geometry for transit routes", () => {
    const r = route(
      line([
        [103.8, 1.3],
        [103.81, 1.31],
      ]),
    );
    r.legs = [
      {
        type: "walk",
        geojson: line([
          [103.8, 1.3],
          [103.81, 1.31],
        ]),
      },
      {
        type: "transit",
        geojson: line([
          [103.81, 1.31],
          [103.9, 1.36],
        ]),
        travelTimeSec: 600,
      },
      {
        type: "walk",
        geojson: line([
          [103.9, 1.36],
          [103.92, 1.33],
        ]),
      },
    ];

    expect(routeBounds(r)).toEqual([
      [103.8, 1.3],
      [103.92, 1.36],
    ]);
  });

  it("ignores invalid coordinates and returns null for empty geometry", () => {
    expect(
      routeBounds(
        route(
          line([
            [Number.NaN, 1.3],
            [103.8, Number.POSITIVE_INFINITY],
          ]),
        ),
      ),
    ).toBeNull();
  });
});

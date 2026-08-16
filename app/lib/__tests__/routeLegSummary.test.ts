import { describe, expect, it } from "vitest";
import { routeLegSummary } from "../routeLegSummary";
import type { RouteLeg } from "../routing";

const line: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
};

describe("routeLegSummary", () => {
  it("summarizes walking legs with distance and shade", () => {
    const leg: RouteLeg = {
      type: "walk",
      geojson: line,
      distanceM: 845,
      shadeCoverage: 0.42,
    };

    expect(routeLegSummary(leg, 0)).toEqual({
      title: "Leg 1: Walk",
      detail: "845 m - 42% shade",
    });
  });

  it("summarizes transit legs with line, time, stops, and sun exposure", () => {
    const leg: RouteLeg = {
      type: "transit",
      geojson: line,
      lineName: "Red Line",
      travelTimeSec: 620,
      stops: ["A", "B", "C"],
      sunExposure: 0,
    };

    expect(routeLegSummary(leg, 1)).toEqual({
      title: "Leg 2: Red Line",
      detail: "11 min - 2 stops - underground",
    });
  });
});

/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteOption } from "../../lib/routing";
import type { SavedRoute } from "../../lib/savedRoutes";
import { downloadBlob } from "../../lib/exportRoute";
import { geocodeReverse } from "../../lib/nominatim";
import { useNavigation } from "../useNavigation";

vi.mock("../../lib/nominatim", () => ({
  geocodeReverse: vi.fn(),
}));

vi.mock("../../lib/exportRoute", async () => {
  const actual = await vi.importActual<typeof import("../../lib/exportRoute")>(
    "../../lib/exportRoute",
  );
  return {
    ...actual,
    downloadBlob: vi.fn(),
  };
});

function line(coordinates: [number, number][]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}

function route(label = "Shortest", shadeCoverage = 0.4): RouteOption {
  return {
    label,
    geojson: line([
      [103.8, 1.3],
      [103.81, 1.31],
    ]),
    distanceM: 1000,
    shadeCoverage,
    longestContinuousShadeM: 120,
    shadeTransitions: 2,
    detourRatio: 1,
    turnCount: 3,
  };
}

function savedRoute(routeOption: RouteOption): SavedRoute {
  return {
    id: "saved-1",
    name: routeOption.label,
    folderId: null,
    routeOption,
    waypointA: [103.8, 1.3],
    waypointB: [103.9, 1.35],
    waypointALabel: "Start",
    waypointBLabel: "End",
    additionalWaypoints: [[103.85, 1.32]],
    timeOfDayMinutes: 9 * 60 + 30,
    dateIso: "2026-08-16",
    createdAt: 1,
  };
}

function renderUseNavigation() {
  return renderHook(() =>
    useNavigation({
      mapRef: { current: null },
      dateRef: { current: new Date("2026-08-16T12:00:00Z") },
      setDate: vi.fn(),
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(geocodeReverse).mockResolvedValue("Reverse geocode label");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useNavigation", () => {
  it("places waypoint A from a pending map click and advances to waypoint B", async () => {
    const { result } = renderUseNavigation();

    act(() => result.current.setPendingSlot("A"));
    act(() => result.current.handleMapClick({ lng: 103.8, lat: 1.3 }));

    expect(result.current.waypointA).toEqual([103.8, 1.3]);
    expect(result.current.waypointALabel).toBe("1.300, 103.800");
    expect(result.current.pendingSlot).toBe("B");

    await waitFor(() => {
      expect(result.current.waypointALabel).toBe("Reverse geocode label");
    });
  });

  it("loads a saved transit route and derives walk-rendered route geometry", () => {
    const transitRoute = route("Via Transit", 0.25);
    transitRoute.legs = [
      { type: "walk", geojson: line([[103.8, 1.3], [103.81, 1.31]]) },
      {
        type: "transit",
        geojson: line([[103.81, 1.31], [103.88, 1.34]]),
        travelTimeSec: 600,
      },
      { type: "walk", geojson: line([[103.88, 1.34], [103.9, 1.35]]) },
    ];
    transitRoute.trainDrawData = {
      polylines: [],
      stops: [],
      transfers: [],
    };

    const { result } = renderUseNavigation();

    act(() => result.current.handleRouteModeChange("transit"));
    act(() => result.current.handleLoadRoute(savedRoute(transitRoute)));

    expect(result.current.navRoutes).toEqual([transitRoute]);
    expect(result.current.filteredRoutes).toEqual([transitRoute]);
    expect(result.current.selectedNavRoute).toEqual({
      type: "FeatureCollection",
      features: [transitRoute.legs[0].geojson, transitRoute.legs[2].geojson],
    });
    expect(result.current.navTrainDrawData).toBe(transitRoute.trainDrawData);
    expect(result.current.additionalWaypoints).toEqual([[103.85, 1.32]]);
    expect(result.current.canTransit).toBe(true);

    act(() => result.current.handleRouteModeChange("walk"));

    expect(result.current.navRoutes).toEqual([]);
    expect(result.current.filteredRoutes).toEqual([]);
  });

  it("warns instead of exporting an incomplete partial route", () => {
    const partialRoute = route("Partial", 0.6);
    partialRoute.partial = { completedLegs: 1, failedLeg: 2, totalLegs: 3 };
    const { result } = renderUseNavigation();

    act(() => result.current.handleLoadRoute(savedRoute(partialRoute)));
    act(() => result.current.handleExportRoute(0, "geojson"));

    expect(downloadBlob).not.toHaveBeenCalled();
    expect(result.current.navWarning).toBe(
      "Could not finish leg 2 of 3; showing 1 completed leg.",
    );
  });

  it("clears route and sketch state when navigation is reset", () => {
    const { result } = renderUseNavigation();

    act(() => result.current.handleLoadRoute(savedRoute(route())));
    act(() => result.current.handleAddAdditionalWaypoint([103.82, 1.31]));
    act(() => result.current.handleDrawModeToggle());
    act(() => result.current.handleSketchPointClick([103.83, 1.32]));

    expect(result.current.navRoutes).toHaveLength(0);
    expect(result.current.additionalWaypoints).toEqual([[103.85, 1.32], [103.82, 1.31]]);
    expect(result.current.drawMode).toBe(true);
    expect(result.current.sketchPoints).toHaveLength(1);

    act(() => result.current.handleClear());

    expect(result.current.waypointA).toBeNull();
    expect(result.current.waypointB).toBeNull();
    expect(result.current.additionalWaypoints).toEqual([]);
    expect(result.current.navRoutes).toEqual([]);
    expect(result.current.drawMode).toBe(false);
    expect(result.current.sketchPoints).toEqual([]);
    expect(result.current.selectedNavRoute).toBeNull();
  });
});

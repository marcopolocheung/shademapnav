/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteOption } from "../../lib/routing";
import type { SavedRoute } from "../../lib/savedRoutes";
import { downloadBlob } from "../../lib/exportRoute";
import { geocodeReverse } from "../../lib/nominatim";
import { fetchRoutingGraph } from "../../lib/overpass";
import { sampleBothSidewalks } from "../../lib/shadeSampling";
import { useNavigation } from "../useNavigation";

vi.mock("../../lib/nominatim", () => ({
  geocodeReverse: vi.fn(),
}));

vi.mock("../../lib/overpass", async () => {
  const actual = await vi.importActual<typeof import("../../lib/overpass")>(
    "../../lib/overpass",
  );
  return { ...actual, fetchRoutingGraph: vi.fn(), fetchStationEntrances: vi.fn() };
});

/**
 * The shade field, swappable per test. `vi.hoisted` because `vi.mock`'s factory runs
 * when `useNavigation` is first imported, before this file's own consts initialise.
 */
const shadeStub = vi.hoisted(() => ({
  coverage: { source: "tiles" as string, confidence: 0.8 },
  /** Per-edge answers, in the order `sampleEdges` was handed them. */
  edgeShade: [] as Array<{ left: number; right: number; source: string; confidence: number }>,
  readyError: null as Error | null,
  readyGate: null as Promise<void> | null,
  sampledBatchSizes: [] as number[],
}));

vi.mock("../../lib/shade/ShadeField", async () => {
  const actual = await vi.importActual<typeof import("../../lib/shade/ShadeField")>(
    "../../lib/shade/ShadeField",
  );
  return {
    ...actual,
    createGeometryShadeField: () => ({
      shadeAt: () => ({ shade: 0, source: "none", confidence: 0 }),
      sweep: () => [],
      coverage: () => shadeStub.coverage,
      sampleEdges: (edges: unknown[]) => {
        shadeStub.sampledBatchSizes.push(edges.length);
        return edges.map((_, i) => shadeStub.edgeShade[i] ?? shadeStub.edgeShade[0]);
      },
      ready: async () => {
        if (shadeStub.readyGate) await shadeStub.readyGate;
        if (shadeStub.readyError) throw shadeStub.readyError;
      },
    }),
  };
});

vi.mock("../../lib/shadeSampling", async () => {
  const actual = await vi.importActual<typeof import("../../lib/shadeSampling")>(
    "../../lib/shadeSampling",
  );
  return { ...actual, sampleBothSidewalks: vi.fn(actual.sampleBothSidewalks) };
});

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

// ─── Flat shade readback (#154) ───────────────────────────────────────────────

/**
 * The shade sampler classifies blue-dominant pixels as shade and the shadow layer
 * paints buildings with that same field, so the canvas has to be read at pitch 0
 * or an occluded sidewalk scores shaded. These drive `calculateRoute` far enough
 * to reach the readback and assert what the camera was doing when it happened.
 */

type FakeBounds = { west: number; south: number; east: number; north: number };

interface FakeMapOptions {
  pitch: number;
  /** Bounds by pitch — a tilted camera sees a larger box than a flat one. */
  boundsAtPitch: (pitch: number) => FakeBounds;
  /** When false, `idle` never fires — as during timeline playback. */
  emitIdle?: boolean;
}

function fakeMap(opts: FakeMapOptions) {
  const log: string[] = [];
  let pitch = opts.pitch;
  const idleHandlers: Array<() => void> = [];

  const map = {
    getPitch: () => pitch,
    getZoom: () => 16,
    // Only camera moves that touch pitch are what these tests are about; the
    // waypoint helpers also `jumpTo` a centre and zoom, which is noise here.
    jumpTo: (camera: { pitch?: number }) => {
      if (camera.pitch === undefined) return;
      pitch = camera.pitch;
      log.push(`jumpTo(${camera.pitch})`);
    },
    easeTo: (camera: { pitch?: number }) => {
      if (camera.pitch === undefined) return;
      pitch = camera.pitch;
      log.push(`easeTo(${camera.pitch})`);
    },
    getBounds: () => {
      const b = opts.boundsAtPitch(pitch);
      return {
        getWest: () => b.west,
        getSouth: () => b.south,
        getEast: () => b.east,
        getNorth: () => b.north,
      };
    },
    fitBounds: () => log.push("fitBounds"),
    once: (event: string, cb: () => void) => {
      if (event !== "idle") return;
      if (opts.emitIdle === false) idleHandlers.push(cb);
      else setTimeout(cb, 0);
    },
    off: () => {},
    getCanvas: () => {
      log.push(`getCanvas@pitch${pitch}`);
      return { width: 8, height: 8 } as unknown as HTMLCanvasElement;
    },
    project: () => ({ x: 0, y: 0 }),
    querySourceFeatures: () => [],
  };

  return { map, log, idleHandlers, getPitch: () => pitch };
}

/** jsdom has no 2D context, and the readback needs one. */
function stubCanvas2d() {
  const proto = window.HTMLCanvasElement.prototype as unknown as {
    getContext: unknown;
  };
  const original = proto.getContext;
  proto.getContext = () => ({
    drawImage: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
  });
  return () => {
    proto.getContext = original;
  };
}

/** Two nodes joined by one edge — enough to reach and exercise the readback. */
function twoNodeGraph() {
  return {
    nodes: new Map([
      [1, { id: 1, lat: 1.3, lon: 103.8 }],
      [2, { id: 2, lat: 1.301, lon: 103.801 }],
    ]),
    adj: new Map([
      [1, [{ toId: 2, distanceM: 150 }]],
      [2, [{ toId: 1, distanceM: 150 }]],
    ]),
  };
}

async function runRouteWith(map: unknown) {
  const { result } = renderHook(() =>
    useNavigation({
      mapRef: { current: map as never },
      dateRef: { current: new Date("2026-08-16T04:00:00Z") },
      setDate: vi.fn(),
    }),
  );

  act(() => result.current.handleSetWaypointA([103.8, 1.3], "Start"));
  act(() => result.current.handleSetWaypointB([103.801, 1.301], "End"));

  await act(async () => {
    result.current.handleCalculateRoute();
  });
  await waitFor(() => expect(result.current.isCalculating).toBe(false), {
    timeout: 4000,
  });
  return result;
}

/** The field answers confidently from tiles unless a test says otherwise. */
function resetShadeStub() {
  shadeStub.coverage = { source: "tiles", confidence: 0.8 };
  shadeStub.edgeShade = [{ left: 1, right: 1, source: "tiles", confidence: 0.8 }];
  shadeStub.readyError = null;
  shadeStub.readyGate = null;
  shadeStub.sampledBatchSizes = [];
  vi.mocked(sampleBothSidewalks).mockClear();
}

/** Three nodes in a line — two undirected edges, so "only that edge" is testable. */
function threeNodeGraph() {
  return {
    nodes: new Map([
      [1, { id: 1, lat: 1.3, lon: 103.8 }],
      [2, { id: 2, lat: 1.3005, lon: 103.8005 }],
      [3, { id: 3, lat: 1.301, lon: 103.801 }],
    ]),
    adj: new Map([
      [1, [{ toId: 2, distanceM: 75 }]],
      [2, [{ toId: 1, distanceM: 75 }, { toId: 3, distanceM: 75 }]],
      [3, [{ toId: 2, distanceM: 75 }]],
    ]),
  };
}

describe("flat shade readback (#154)", () => {
  let restoreCanvas: () => void;

  beforeEach(() => {
    restoreCanvas = stubCanvas2d();
    vi.mocked(fetchRoutingGraph).mockResolvedValue(twoNodeGraph() as never);
    resetShadeStub();
    // These tests are about the canvas path, so keep the field unable to answer.
    shadeStub.coverage = { source: "none", confidence: 0 };
    shadeStub.edgeShade = [{ left: 0, right: 0, source: "none", confidence: 0 }];
  });

  afterEach(() => restoreCanvas());

  // A generous box, in view at every pitch, so `fitBounds` is not what is under test.
  const wideBounds = () => ({ west: 100, south: -1, east: 107, north: 5 });

  it("reads the canvas flat and gives the tilt back", async () => {
    const { map, log } = fakeMap({ pitch: 55, boundsAtPitch: wideBounds });

    await runRouteWith(map);

    const flattened = log.indexOf("jumpTo(0)");
    const read = log.findIndex((entry) => entry.startsWith("getCanvas@"));
    expect(flattened).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(flattened);
    expect(log[read]).toBe("getCanvas@pitch0");
    expect(log.slice(read)).toContain("easeTo(55)");
  });

  it("leaves an already-flat camera alone", async () => {
    const { map, log } = fakeMap({ pitch: 0, boundsAtPitch: wideBounds });

    await runRouteWith(map);

    expect(log.filter((entry) => entry.startsWith("jumpTo"))).toEqual([]);
    expect(log.filter((entry) => entry.startsWith("easeTo"))).toEqual([]);
    expect(log).toContain("getCanvas@pitch0");
  });

  it("re-tests the route bbox against the flat camera, not the tilted one", async () => {
    // Tilted the map sees the whole region; flat it sees almost nothing. The old
    // code asked the tilted camera, skipped `fitBounds`, and then sampled a canvas
    // that did not contain the route.
    const { map, log } = fakeMap({
      pitch: 55,
      boundsAtPitch: (pitch) =>
        pitch > 0
          ? { west: 100, south: -1, east: 107, north: 5 }
          : { west: 103.7999, south: 1.2999, east: 103.8001, north: 1.3001 },
    });

    await runRouteWith(map);

    // `fitMapToRoute` also fits at the end, so the claim has to be that a fit
    // happened *before* the readback — otherwise this passes for the wrong reason.
    const read = log.findIndex((entry) => entry.startsWith("getCanvas@"));
    const fitBeforeRead = log.slice(0, read).indexOf("fitBounds");
    expect(read).toBeGreaterThanOrEqual(0);
    expect(fitBeforeRead).toBeGreaterThan(log.indexOf("jumpTo(0)"));
  });

  it("leaves the camera alone entirely when the graph fetch fails", async () => {
    // A4b moved the flatten after the graph fetch, so a fetch that never returns a
    // graph no longer disturbs the camera at all. That is strictly stronger than
    // #154's guarantee — there is no tilt to give back because none was taken.
    vi.mocked(fetchRoutingGraph).mockRejectedValue(new Error("Overpass is down"));
    const { map, log } = fakeMap({ pitch: 60, boundsAtPitch: wideBounds });

    await runRouteWith(map);

    expect(log).not.toContain("jumpTo(0)");
    expect(map.getPitch()).toBe(60);
  });

  it("reads the canvas anyway when idle never arrives", async () => {
    // The timeline's play mode repaints every 50 ms, so `idle` never fires.
    const { map, log } = fakeMap({
      pitch: 45,
      boundsAtPitch: wideBounds,
      emitIdle: false,
    });

    await runRouteWith(map);

    expect(log).toContain("getCanvas@pitch0");
    expect(log).toContain("easeTo(45)");
  });
});


describe("routing reads the shade field (A4b)", () => {
  let restoreCanvas: () => void;

  beforeEach(() => {
    restoreCanvas = stubCanvas2d();
    vi.mocked(fetchRoutingGraph).mockResolvedValue(twoNodeGraph() as never);
    resetShadeStub();
  });

  afterEach(() => restoreCanvas());

  const wideBounds = () => ({ west: 100, south: -1, east: 107, north: 5 });

  // A box far too small to contain the route, so the canvas path is obliged to fit
  // the camera onto it before reading. That is what makes the next test's claim mean
  // something: with geometry available, that fit must not happen.
  const narrowBounds = () => ({ west: 103.7999, south: 1.2999, east: 103.8001, north: 1.3001 });

  it("never touches the canvas or the camera when geometry covers the route", async () => {
    const { map, log } = fakeMap({ pitch: 0, boundsAtPitch: narrowBounds });

    const result = await runRouteWith(map);

    expect(log.some((entry) => entry.startsWith("getCanvas@"))).toBe(false);
    expect(vi.mocked(sampleBothSidewalks)).not.toHaveBeenCalled();
    // The only fit is `fitMapToRoute` showing the finished route.
    expect(log.filter((entry) => entry === "fitBounds")).toHaveLength(1);
    expect(result.current.navRoutes.length).toBeGreaterThan(0);
  });

  it("does fit and read when geometry cannot answer, so the last test discriminates", async () => {
    shadeStub.coverage = { source: "none", confidence: 0 };
    shadeStub.edgeShade = [{ left: 0, right: 0, source: "none", confidence: 0 }];
    const { map, log } = fakeMap({ pitch: 0, boundsAtPitch: narrowBounds });

    await runRouteWith(map);

    expect(log.some((entry) => entry.startsWith("getCanvas@"))).toBe(true);
    expect(log.filter((entry) => entry === "fitBounds")).toHaveLength(2);
  });

  it("routes on the field's own left/right values", async () => {
    shadeStub.edgeShade = [{ left: 1, right: 1, source: "tiles", confidence: 0.8 }];
    const { map } = fakeMap({ pitch: 0, boundsAtPitch: wideBounds });

    const result = await runRouteWith(map);

    // Fully shaded sidewalks on the only edge there is, so the route inherits it.
    expect(result.current.navRoutes[0].shadeCoverage).toBe(1);
    expect(result.current.navRoutes[0].shadeSource?.dominant).toBe("tiles");
  });

  it("falls back to pixels for a weak edge and only that edge", async () => {
    vi.mocked(fetchRoutingGraph).mockResolvedValue(threeNodeGraph() as never);
    shadeStub.coverage = { source: "tiles", confidence: 0.2 }; // so a canvas exists
    shadeStub.edgeShade = [
      { left: 1, right: 1, source: "tiles", confidence: 0.8 },
      { left: 0, right: 0, source: "tiles", confidence: 0.2 },
    ];
    const { map } = fakeMap({ pitch: 0, boundsAtPitch: wideBounds });

    const result = await runRouteWith(map);

    expect(vi.mocked(sampleBothSidewalks)).toHaveBeenCalledTimes(1);
    expect(result.current.navRoutes[0].shadeSource?.bySource.canvas).toBeGreaterThan(0);
    expect(result.current.navRoutes[0].shadeSource?.bySource.tiles).toBeGreaterThan(0);
  });

  it("still routes, from the map view, when no geometry resolves at all", async () => {
    shadeStub.coverage = { source: "none", confidence: 0 };
    shadeStub.edgeShade = [{ left: 0, right: 0, source: "none", confidence: 0 }];
    const { map } = fakeMap({ pitch: 0, boundsAtPitch: wideBounds });

    const result = await runRouteWith(map);

    expect(result.current.navRoutes.length).toBeGreaterThan(0);
    expect(result.current.navRoutes[0].shadeSource?.dominant).toBe("canvas");
  });

  it("hands the whole edge set to the field in one batch", async () => {
    vi.mocked(fetchRoutingGraph).mockResolvedValue(threeNodeGraph() as never);
    shadeStub.edgeShade = [{ left: 0, right: 0, source: "tiles", confidence: 0.8 }];
    const { map } = fakeMap({ pitch: 0, boundsAtPitch: wideBounds });

    await runRouteWith(map);

    // Slicing the batch would rebuild the field's internal per-cell shadow indices.
    expect(shadeStub.sampledBatchSizes).toEqual([2]);
  });

  it("routes anyway when the geometry preload fails", async () => {
    // Overpass rate-limits constantly; that is a reason to fall back, not to fail.
    shadeStub.readyError = new Error("429 Too Many Requests");
    shadeStub.coverage = { source: "none", confidence: 0 };
    shadeStub.edgeShade = [{ left: 0, right: 0, source: "none", confidence: 0 }];
    const { map } = fakeMap({ pitch: 0, boundsAtPitch: wideBounds });

    const result = await runRouteWith(map);

    expect(result.current.navError).toBeNull();
    expect(result.current.navRoutes.length).toBeGreaterThan(0);
  });

  it("writes nothing when cancelled during the geometry preload", async () => {
    let openGate: () => void = () => {};
    shadeStub.readyGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const { map, log } = fakeMap({ pitch: 60, boundsAtPitch: wideBounds });

    const { result } = renderHook(() =>
      useNavigation({
        mapRef: { current: map as never },
        dateRef: { current: new Date("2026-08-16T04:00:00Z") },
        setDate: vi.fn(),
      }),
    );
    act(() => result.current.handleSetWaypointA([103.8, 1.3], "Start"));
    act(() => result.current.handleSetWaypointB([103.801, 1.301], "End"));
    await act(async () => {
      result.current.handleCalculateRoute();
    });

    act(() => result.current.handleClearWaypointA());
    await act(async () => {
      openGate();
    });

    expect(result.current.navRoutes).toEqual([]);
    // Nothing was flattened, so the finally has no tilt to give back.
    expect(log).not.toContain("jumpTo(0)");
    expect(map.getPitch()).toBe(60);
  });
});

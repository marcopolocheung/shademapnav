import { describe, expect, it, vi } from "vitest";
import type { BuildingFootprint } from "../../overpass";
import { type BBox, bboxAroundPoint, createGeometryShadeField } from "../ShadeField";
import type { BuildingFeatureLike } from "../geometry";
import {
  type TileMapLike,
  bboxRadiusM,
  createOverpassPrismProvider,
  createTilePrismProvider,
} from "../providers";

const LAT = 40.4168;
const LNG = -3.7038;

function square(centreLng: number, centreLat: number, halfDeg: number): [number, number][] {
  return [
    [centreLng - halfDeg, centreLat - halfDeg],
    [centreLng + halfDeg, centreLat - halfDeg],
    [centreLng + halfDeg, centreLat + halfDeg],
    [centreLng - halfDeg, centreLat + halfDeg],
    [centreLng - halfDeg, centreLat - halfDeg],
  ];
}

function tileFeature(height: number): BuildingFeatureLike {
  return {
    properties: { render_height: height },
    geometry: { type: "Polygon", coordinates: [square(LNG, LAT, 0.0002)] },
  };
}

interface FakeMapOpts {
  zoom?: number;
  bounds?: BBox;
  features?: BuildingFeatureLike[];
}

function fakeMap(opts: FakeMapOpts = {}) {
  const bounds = opts.bounds ?? bboxAroundPoint(LNG, LAT, 2000);
  const querySourceFeatures = vi.fn(() => opts.features ?? [tileFeature(18)]);

  const map: TileMapLike = {
    getZoom: () => opts.zoom ?? 16,
    getBounds: () => ({
      getWest: () => bounds.west,
      getSouth: () => bounds.south,
      getEast: () => bounds.east,
      getNorth: () => bounds.north,
    }),
    querySourceFeatures,
  };

  return { map, querySourceFeatures };
}

describe("createTilePrismProvider", () => {
  const inView = bboxAroundPoint(LNG, LAT, 300);

  it("returns prisms for a bbox inside the current view", () => {
    const { map } = fakeMap();
    const set = createTilePrismProvider(() => map).prismsFor(inView);

    expect(set?.prisms).toHaveLength(1);
    expect(set?.maxHeightM).toBe(18);
  });

  it("queries the building layer of the MapTiler source", () => {
    const { map, querySourceFeatures } = fakeMap();
    createTilePrismProvider(() => map).prismsFor(inView);

    expect(querySourceFeatures).toHaveBeenCalledWith("maptiler_planet", {
      sourceLayer: "building",
    });
  });

  it("declines a bbox outside the current view rather than reporting no buildings", () => {
    const { map } = fakeMap({ bounds: bboxAroundPoint(LNG, LAT, 100) });

    // An empty PrismSet here would read as "open sky" at high confidence. The whole
    // point of the null is that off-screen means "I don't know".
    expect(createTilePrismProvider(() => map).prismsFor(bboxAroundPoint(LNG, LAT, 5000))).toBeNull();
  });

  it("declines below the zoom where MapTiler serves building geometry", () => {
    const { map, querySourceFeatures } = fakeMap({ zoom: 11 });

    expect(createTilePrismProvider(() => map).prismsFor(inView)).toBeNull();
    expect(querySourceFeatures).not.toHaveBeenCalled();
  });

  it("declines when there is no map yet", () => {
    expect(createTilePrismProvider(() => null).prismsFor(inView)).toBeNull();
  });

  it("queries once per view, not once per edge", () => {
    const { map, querySourceFeatures } = fakeMap();
    const provider = createTilePrismProvider(() => map);

    provider.prismsFor(inView);
    provider.prismsFor(bboxAroundPoint(LNG, LAT, 200));
    provider.prismsFor(bboxAroundPoint(LNG + 0.001, LAT, 150));

    expect(querySourceFeatures).toHaveBeenCalledTimes(1);
  });

  it("re-queries once the map has moved", () => {
    let bounds = bboxAroundPoint(LNG, LAT, 2000);
    const querySourceFeatures = vi.fn(() => [tileFeature(18)]);
    const map: TileMapLike = {
      getZoom: () => 16,
      getBounds: () => ({
        getWest: () => bounds.west,
        getSouth: () => bounds.south,
        getEast: () => bounds.east,
        getNorth: () => bounds.north,
      }),
      querySourceFeatures,
    };
    const provider = createTilePrismProvider(() => map);

    provider.prismsFor(inView);
    bounds = bboxAroundPoint(LNG + 0.05, LAT, 2000);
    provider.prismsFor(bboxAroundPoint(LNG + 0.05, LAT, 300));

    expect(querySourceFeatures).toHaveBeenCalledTimes(2);
  });
});

describe("createOverpassPrismProvider", () => {
  const bbox = bboxAroundPoint(LNG, LAT, 200);

  function footprints(heightM = 12): BuildingFootprint[] {
    return [{ id: 1, heightM, rings: [square(LNG, LAT, 0.0002)] }];
  }

  it("answers nothing before anything is loaded", () => {
    expect(createOverpassPrismProvider({ fetchFootprints: vi.fn() }).prismsFor(bbox)).toBeNull();
  });

  it("answers from cache after load", async () => {
    const fetchFootprints = vi.fn(async () => footprints());
    const provider = createOverpassPrismProvider({ fetchFootprints });

    await provider.load?.(bbox);

    expect(provider.prismsFor(bbox)?.prisms).toHaveLength(1);
    expect(fetchFootprints).toHaveBeenCalledTimes(1);
  });

  it("fetches a radius wider than the bbox, since shadows come from outside it", async () => {
    const fetchFootprints = vi.fn(async (_lng: number, _lat: number, _radiusM: number) =>
      footprints()
    );
    await createOverpassPrismProvider({ fetchFootprints }).load?.(bbox);

    const [, , radiusM] = fetchFootprints.mock.calls[0];
    expect(radiusM).toBeGreaterThan(bboxRadiusM(bbox));
  });

  it("does not refetch an area it already covers", async () => {
    const fetchFootprints = vi.fn(async () => footprints());
    const provider = createOverpassPrismProvider({ fetchFootprints });

    await provider.load?.(bbox);
    await provider.load?.(bboxAroundPoint(LNG, LAT, 50));

    expect(fetchFootprints).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent loads of the same area into one request", async () => {
    const fetchFootprints = vi.fn(async () => footprints());
    const provider = createOverpassPrismProvider({ fetchFootprints });

    await Promise.all([provider.load?.(bbox), provider.load?.(bbox), provider.load?.(bbox)]);

    expect(fetchFootprints).toHaveBeenCalledTimes(1);
  });

  it("declines an area too large for one Overpass call instead of issuing a doomed request", async () => {
    const fetchFootprints = vi.fn(async () => footprints());
    const provider = createOverpassPrismProvider({ fetchFootprints, maxFetchRadiusM: 500 });

    await provider.load?.(bboxAroundPoint(LNG, LAT, 5000));

    expect(fetchFootprints).not.toHaveBeenCalled();
    expect(provider.prismsFor(bboxAroundPoint(LNG, LAT, 5000))).toBeNull();
  });

  it("caches nothing when the fetch fails, so the field keeps saying it does not know", async () => {
    const fetchFootprints = vi.fn(async () => {
      throw new Error("Overpass building API error: 429 Too Many Requests");
    });
    const provider = createOverpassPrismProvider({ fetchFootprints });

    await expect(provider.load?.(bbox)).resolves.toBeUndefined();
    // Caching the failure as an empty set would turn a rate limit into a confident
    // claim of open sky.
    expect(provider.prismsFor(bbox)).toBeNull();
  });

  it("evicts old areas but keeps the one most recently used", async () => {
    const fetchFootprints = vi.fn(async () => footprints());
    const provider = createOverpassPrismProvider({ fetchFootprints });

    const areas = [0, 1, 2, 3, 4].map((i) => bboxAroundPoint(LNG + i * 0.5, LAT, 200));
    for (const area of areas.slice(0, 4)) await provider.load?.(area);

    provider.prismsFor(areas[0]); // touch the oldest so it survives
    await provider.load?.(areas[4]);

    expect(provider.prismsFor(areas[0])).not.toBeNull();
    expect(provider.prismsFor(areas[4])).not.toBeNull();
    expect(provider.prismsFor(areas[1])).toBeNull(); // the untouched oldest is gone
  });
});

describe("the two providers together", () => {
  it("uses tiles in view and Overpass outside it", async () => {
    const { map, querySourceFeatures } = fakeMap({ bounds: bboxAroundPoint(LNG, LAT, 500) });
    const fetchFootprints = vi.fn(async () => [
      { id: 1, heightM: 30, rings: [square(LNG + 1, LAT, 0.0002)] } as BuildingFootprint,
    ]);

    const field = createGeometryShadeField([
      createTilePrismProvider(() => map),
      createOverpassPrismProvider({ fetchFootprints }),
    ]);

    const inView = field.shadeAt(LNG, LAT, new Date("2026-06-21T12:00:00Z"));
    expect(inView.source).toBe("tiles");
    expect(querySourceFeatures).toHaveBeenCalled();

    const farAway: BBox = bboxAroundPoint(LNG + 1, LAT, 300);
    await field.ready(farAway);
    const outOfView = field.shadeAt(LNG + 1, LAT, new Date("2026-06-21T12:00:00Z"));

    expect(outOfView.source).toBe("overpass");
    expect(fetchFootprints).toHaveBeenCalled();
  });

  it("reports no source at all when neither provider can answer", () => {
    const field = createGeometryShadeField([
      createTilePrismProvider(() => null),
      createOverpassPrismProvider({ fetchFootprints: vi.fn() }),
    ]);

    const sample = field.shadeAt(LNG, LAT, new Date("2026-06-21T12:00:00Z"));

    expect(sample).toEqual({ shade: 0, source: "none", confidence: 0 });
  });
});

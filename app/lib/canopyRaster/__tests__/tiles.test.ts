import { describe, expect, it } from "vitest";
import {
  CANOPY_TILE_ZOOM,
  groundResolution,
  lonLatToMercator,
  mercatorToLonLat,
  pixelWindowFor,
  quadkeyFor,
  quadkeysForBbox,
  selectOverview,
  windowBbox,
} from "../tiles";

/**
 * The three A3 corpus centres, so the transport prototype and the agreement
 * corpus describe the same places.
 */
const MADRID: [number, number] = [-3.7038, 40.4168];
const SINGAPORE: [number, number] = [103.8198, 1.3521];
const KENT_WA: [number, number] = [-122.2348, 47.3809];

/**
 * The real Madrid tile's geotransform, read off `chm/0331110121.tif`. Hard-coding
 * it is what keeps these tests hermetic: the grid is a fixed property of the
 * published dataset, so a test that has to fetch 84 MB to check pixel arithmetic
 * would be testing the network.
 */
const MADRID_TILE_BBOX: [number, number, number, number] = [
  -430493.34330211265, 4891969.81025128, -391357.5848201024, 4931105.568733291,
];
const MADRID_TILE_SPAN = MADRID_TILE_BBOX[2] - MADRID_TILE_BBOX[0];

/** The published IFD layout: full resolution plus seven overview levels. */
const HEIGHT_IMAGES = [
  { index: 0, width: 32768 },
  { index: 2, width: 16384 },
  { index: 3, width: 8192 },
  { index: 4, width: 4096 },
  { index: 5, width: 2048 },
  { index: 6, width: 1024 },
  { index: 7, width: 512 },
];

describe("quadkeyFor", () => {
  it("names the tile every figure in the feasibility note was measured over", () => {
    expect(quadkeyFor(MADRID[0], MADRID[1])).toBe("0331110121");
  });

  it("produces a quadkey of one digit per zoom level", () => {
    expect(quadkeyFor(MADRID[0], MADRID[1])).toHaveLength(CANOPY_TILE_ZOOM);
    expect(quadkeyFor(SINGAPORE[0], SINGAPORE[1])).toHaveLength(CANOPY_TILE_ZOOM);
  });

  it("separates the three corpus cities", () => {
    const keys = [MADRID, SINGAPORE, KENT_WA].map(([lon, lat]) => quadkeyFor(lon, lat));
    expect(new Set(keys).size).toBe(3);
  });

  it("places the four quadrants of the world in the right octant", () => {
    // Zoom 1: 0 = NW, 1 = NE, 2 = SW, 3 = SE.
    expect(quadkeyFor(-90, 45, 1)).toBe("0");
    expect(quadkeyFor(90, 45, 1)).toBe("1");
    expect(quadkeyFor(-90, -45, 1)).toBe("2");
    expect(quadkeyFor(90, -45, 1)).toBe("3");
  });
});

describe("quadkeysForBbox", () => {
  it("reports one tile for a route-sized box", () => {
    const aoi = boxAround(MADRID, 2000);
    expect(quadkeysForBbox(aoi)).toEqual(["0331110121"]);
  });

  it("reports every tile a box straddles, so the reader can decline it", () => {
    // A box wide enough to cross a zoom 10 tile edge wherever it is centred.
    const aoi = boxAround(MADRID, 80_000);
    expect(quadkeysForBbox(aoi).length).toBeGreaterThan(1);
  });

  /**
   * The interior, not just the corners. Sampling a bbox's four corners is enough
   * to decide "is this one tile?", and silently omits the middle of anything
   * larger — a box three tiles across would report the two edges and drop the one
   * between them. `CanopyTileStore` (A8b) is the named consumer, so the guarantee
   * has to be the one the name claims.
   */
  it("includes interior tiles, not only the corner ones", () => {
    const aoi = boxAround(MADRID, 120_000);
    const reported = quadkeysForBbox(aoi);

    // Ground truth: every tile hit by a dense lattice over the same box.
    const sampled = new Set<string>();
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const lon = aoi[0] + ((aoi[2] - aoi[0]) * i) / steps;
        const lat = aoi[1] + ((aoi[3] - aoi[1]) * j) / steps;
        sampled.add(quadkeyFor(lon, lat));
      }
    }

    expect(new Set(reported)).toEqual(sampled);
    expect(reported).toHaveLength(new Set(reported).size);
    // A box this wide spans more tiles than it has corners.
    expect(sampled.size).toBeGreaterThan(4);
  });
});

describe("mercator projection", () => {
  it("round-trips a coordinate", () => {
    const [x, y] = lonLatToMercator(MADRID[0], MADRID[1]);
    const [lon, lat] = mercatorToLonLat(x, y);
    expect(lon).toBeCloseTo(MADRID[0], 9);
    expect(lat).toBeCloseTo(MADRID[1], 9);
  });

  it("reproduces the tile bbox the COG header reports", () => {
    // The tile's own corners must project back into its published extent.
    const [west, north] = mercatorToLonLat(MADRID_TILE_BBOX[0], MADRID_TILE_BBOX[3]);
    expect(quadkeyFor(west + 1e-6, north - 1e-6)).toBe("0331110121");
  });
});

describe("groundResolution", () => {
  /**
   * The distinction that makes overview selection portable: mercator metres are
   * not ground metres, and the gap is a factor of 1.3 between Madrid and the
   * equator. The published native resolution is 1.19 mercator m/px.
   */
  it("turns the native 1.19 m/px into 0.91 m on the ground at Madrid", () => {
    expect(groundResolution(1.1943, MADRID[1])).toBeCloseTo(0.91, 2);
  });

  it("leaves the equator alone", () => {
    expect(groundResolution(1.1943, SINGAPORE[1])).toBeCloseTo(1.194, 3);
  });
});

describe("selectOverview", () => {
  it("picks the 1.82 m level for a 2 m pedestrian target at Madrid", () => {
    const chosen = selectOverview(HEIGHT_IMAGES, MADRID_TILE_SPAN, MADRID[1], 2.0);
    expect(chosen.index).toBe(2);
    expect(chosen.width).toBe(16384);
    expect(chosen.groundRes).toBeCloseTo(1.82, 2);
  });

  it("takes the coarsest acceptable level, not the finest available", () => {
    // 4 m is satisfied by the 8192 level (3.64 m); the 16384 level would be
    // four times the pixels for detail the request said it did not need.
    const chosen = selectOverview(HEIGHT_IMAGES, MADRID_TILE_SPAN, MADRID[1], 4.0);
    expect(chosen.index).toBe(3);
  });

  it("falls back to full resolution when the target is finer than the data", () => {
    const chosen = selectOverview(HEIGHT_IMAGES, MADRID_TILE_SPAN, MADRID[1], 0.1);
    expect(chosen.index).toBe(0);
  });

  it("falls back to full resolution at the equator for the same 2 m target", () => {
    // Ground resolution is latitude-dependent, so one request does not resolve
    // to one IFD everywhere. At Madrid 2 m lands on the 1.82 m overview; at
    // Singapore that same overview is 2.39 m — too coarse — so the read drops to
    // native 1.19 m and costs four times the pixels for the same ground area.
    // A8b's tile store inherits this: the expensive city is not the one
    // latitude-naive arithmetic would predict.
    const madrid = selectOverview(HEIGHT_IMAGES, MADRID_TILE_SPAN, MADRID[1], 2.0);
    const singapore = selectOverview(HEIGHT_IMAGES, MADRID_TILE_SPAN, SINGAPORE[1], 2.0);
    expect(madrid.index).toBe(2);
    expect(madrid.groundRes).toBeCloseTo(1.82, 2);
    expect(singapore.index).toBe(0);
    expect(singapore.groundRes).toBeCloseTo(1.19, 2);
  });

  it("refuses to guess when the file exposes no height images", () => {
    expect(() => selectOverview([], MADRID_TILE_SPAN, MADRID[1], 2)).toThrow(/no height images/);
  });
});

describe("pixelWindowFor", () => {
  it("covers a 500 m box in ~275 px at the 1.82 m level", () => {
    const aoi = boxAround(MADRID, 500);
    const [x0, y0, x1, y1] = pixelWindowFor(aoi, MADRID_TILE_BBOX, 16384, 16384);
    expect(x1 - x0).toBeGreaterThan(270);
    expect(x1 - x0).toBeLessThan(282);
    expect(y1 - y0).toBeGreaterThan(270);
    expect(y1 - y0).toBeLessThan(282);
  });

  it("rounds outward, so the strip along the requested edge survives", () => {
    const aoi = boxAround(MADRID, 500);
    const window = pixelWindowFor(aoi, MADRID_TILE_BBOX, 16384, 16384);
    const covered = windowBbox(window, MADRID_TILE_BBOX, 16384, 16384);
    expect(covered[0]).toBeLessThanOrEqual(aoi[0]);
    expect(covered[1]).toBeLessThanOrEqual(aoi[1]);
    expect(covered[2]).toBeGreaterThanOrEqual(aoi[2]);
    expect(covered[3]).toBeGreaterThanOrEqual(aoi[3]);
  });

  it("puts row 0 at the north edge", () => {
    const north = pixelWindowFor(
      boxAround([MADRID[0], MADRID[1] + 0.02], 500),
      MADRID_TILE_BBOX,
      16384,
      16384,
    );
    const south = pixelWindowFor(
      boxAround([MADRID[0], MADRID[1] - 0.02], 500),
      MADRID_TILE_BBOX,
      16384,
      16384,
    );
    expect(north[1]).toBeLessThan(south[1]);
  });

  it("clamps to the image rather than reading off the edge", () => {
    const [west, south, east, north] = [
      MADRID_TILE_BBOX[0],
      MADRID_TILE_BBOX[1],
      MADRID_TILE_BBOX[2],
      MADRID_TILE_BBOX[3],
    ];
    const [w, n] = mercatorToLonLat(west, north);
    const [e, s] = mercatorToLonLat(east, south);
    // An AOI larger than the tile in every direction.
    const window = pixelWindowFor([w - 1, s - 1, e + 1, n + 1], MADRID_TILE_BBOX, 16384, 16384);
    expect(window).toEqual([0, 0, 16384, 16384]);
  });

  it("rejects an area of interest that misses the tile", () => {
    expect(() => pixelWindowFor(boxAround(SINGAPORE, 500), MADRID_TILE_BBOX, 16384, 16384)).toThrow(
      /does not overlap/,
    );
  });
});

/** A square bbox of the given side length, in metres, around a centre. */
function boxAround([lon, lat]: [number, number], sideM: number): [number, number, number, number] {
  const half = sideM / 2;
  const dLat = half / 111_320;
  const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

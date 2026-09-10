import SunCalc from "suncalc";
import { describe, expect, it } from "vitest";
import type { CanopyPatch } from "../../canopyRaster/canopyTileStore";
import { mercatorToLonLat, lonLatToMercator } from "../../canopyRaster/tiles";
import { CROWN_BASE_FRACTION } from "../canopy";
import {
  type BBox,
  type CanopyRasterProvider,
  type EdgeRef,
  bboxContains,
  createGeometryShadowField,
} from "../ShadowField";
import { createCanopyHeightField } from "../canopyRasterField";

/**
 * The ray-march, against patches whose geometry is known exactly.
 *
 * Every case here is "where does this canopy's shadow land", asked of a raster with
 * one or two tall pixels in it and nothing else. That is the whole reason to test the
 * march rather than a real patch: a shadow that lands 15 m from where it should looks
 * entirely plausible on a screenshot and is a wrong route.
 *
 * The trunk is what makes several of these non-obvious. A crown starts at
 * `CROWN_BASE_FRACTION` of its height, so its shadow is a band displaced from the
 * trunk — sunlit ground under the tree, shade further out — and the band slides as the
 * sun drops. A model that painted the crown solid from the ground would pass a "is it
 * shaded 12 m away" test and fail every one of these.
 */

const MADRID: [number, number] = [-3.7038, 40.4168];

/** Ground metres per pixel, and the size of every patch below. Both arbitrary. */
const RES_M = 2;
const SIZE = 201;

/**
 * A square patch centred on a coordinate, with heights from a per-pixel function.
 *
 * The grid is built in Web Mercator, the way `CanopyTileStore` composes a real one,
 * so `metresPerPixel` is ground metres at the centre and the lon/lat bbox is what
 * those pixels actually cover.
 */
function patchAround(
  centre: [number, number],
  heightAt: (col: number, row: number) => number,
  validAt?: (col: number, row: number) => number,
  size = SIZE,
): CanopyPatch {
  const [cx, cy] = lonLatToMercator(centre[0], centre[1]);
  const mercRes = RES_M / Math.cos((centre[1] * Math.PI) / 180);
  const half = (size / 2) * mercRes;
  const [west, south] = mercatorToLonLat(cx - half, cy - half);
  const [east, north] = mercatorToLonLat(cx + half, cy + half);

  const heights = new Uint8Array(size * size);
  let valid: Uint8Array | null = null;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      heights[row * size + col] = heightAt(col, row);
      if (validAt) {
        if (!valid) valid = new Uint8Array(size * size).fill(1);
        valid[row * size + col] = validAt(col, row);
      }
    }
  }

  return {
    heights,
    valid,
    width: size,
    height: size,
    bbox: [west, south, east, north],
    metresPerPixel: RES_M,
    overviewIndex: 0,
    quadkeys: ["test"],
  };
}

/** A coordinate `northM` metres north and `eastM` east of the patch centre. */
function offset(northM: number, eastM = 0): [number, number] {
  const [cx, cy] = lonLatToMercator(MADRID[0], MADRID[1]);
  const scale = 1 / Math.cos((MADRID[1] * Math.PI) / 180);
  return mercatorToLonLat(cx + eastM * scale, cy + northM * scale);
}

/** One 20 m pixel at the patch centre and bare ground everywhere else. */
const CENTRE = (SIZE - 1) / 2;
const TREE_M = 20;
function oneTallPixel() {
  return patchAround(MADRID, (col, row) => (col === CENTRE && row === CENTRE ? TREE_M : 0));
}

/** Due south, 45° up — a shadow exactly as long as the thing casting it. */
const SUN_SOUTH_45 = { azimuth: 0, altitude: Math.PI / 4 };
const JULY = new Date("2026-07-15T12:00:00Z");
const JANUARY = new Date("2026-01-15T12:00:00Z");

describe("canopy height field — where the shadow lands", () => {
  it("shades ground away from the trunk, on the side the sun is not", () => {
    const shade = createCanopyHeightField(oneTallPixel()).shadeFor(
      SUN_SOUTH_45.azimuth, SUN_SOUTH_45.altitude, JULY,
    );

    // The sun is due south at 45°, so a 20 m crown based at 7 m throws its shadow
    // 7-20 m north. One pixel of slack at each end for the march's own step.
    expect(shade.opacityAt(...offset(12))).toBeGreaterThan(0);
    expect(shade.opacityAt(...offset(18))).toBeGreaterThan(0);

    // Under the trunk, and past the crown's tip: both sunlit.
    expect(shade.opacityAt(...offset(2))).toBe(0);
    expect(shade.opacityAt(...offset(30))).toBe(0);

    // South of the tree is between the tree and the sun.
    expect(shade.opacityAt(...offset(-12))).toBe(0);
  });

  it("puts the shadow where the azimuth points, not just north", () => {
    const field = createCanopyHeightField(oneTallPixel());
    // Sun in the east (azimuth -90°): the shadow falls west.
    const shade = field.shadeFor(-Math.PI / 2, Math.PI / 4, JULY);

    expect(shade.opacityAt(...offset(0, -12))).toBeGreaterThan(0);
    expect(shade.opacityAt(...offset(0, 12))).toBe(0);
    expect(shade.opacityAt(...offset(12, 0))).toBe(0);
  });

  it("lengthens the shadow as the sun drops", () => {
    const field = createCanopyHeightField(oneTallPixel());
    const high = field.shadeFor(0, (60 * Math.PI) / 180, JULY);
    const low = field.shadeFor(0, (20 * Math.PI) / 180, JULY);

    // 20 m of crown reaches ~11.5 m north at 60° and ~55 m at 20°.
    const far = offset(40);
    expect(high.opacityAt(...far)).toBe(0);
    expect(low.opacityAt(...far)).toBeGreaterThan(0);

    // And the near end walks outward with it: at 20° the trunk shadow starts ~19 m out.
    expect(high.opacityAt(...offset(8))).toBeGreaterThan(0);
    expect(low.opacityAt(...offset(8))).toBe(0);
  });

  it("shades the ground directly under the canopy when the sun is overhead", () => {
    const field = createCanopyHeightField(oneTallPixel());
    const noon = field.shadeFor(0, (89.9 * Math.PI) / 180, JULY);
    expect(noon.opacityAt(...offset(0))).toBeGreaterThan(0);
    expect(noon.opacityAt(...offset(12))).toBe(0);
  });

  it("reports nothing at all when the sun is down", () => {
    const field = createCanopyHeightField(oneTallPixel());
    expect(field.shadeFor(0, -0.1, JULY).opacityAt(...offset(12))).toBe(0);
  });

  it("reports no shade over a patch with nothing standing in it", () => {
    const field = createCanopyHeightField(patchAround(MADRID, () => 0));
    expect(field.maxHeightM).toBe(0);
    expect(field.shadeFor(0, Math.PI / 4, JULY).opacityAt(...offset(12))).toBe(0);
  });
});

describe("canopy height field — what the opacity is", () => {
  it("stops most of the beam in leaf and much less out of it", () => {
    const field = createCanopyHeightField(oneTallPixel());
    const summer = field.shadeFor(0, Math.PI / 4, JULY).opacityAt(...offset(12));
    const winter = field.shadeFor(0, Math.PI / 4, JANUARY).opacityAt(...offset(12));

    // `crownOpacity`'s published transmittance pair, applied to the raster's extent.
    expect(summer).toBeCloseTo(0.9, 10);
    expect(winter).toBeCloseTo(0.3, 10);
  });

  it("never reports a shadow as opaque as a building", () => {
    const field = createCanopyHeightField(oneTallPixel());
    expect(field.shadeFor(0, Math.PI / 4, JULY).opacityAt(...offset(12))).toBeLessThan(1);
  });
});

describe("canopy height field — nodata is not bare ground", () => {
  it("does not let an unpopulated pixel cast, and reports how much was blank", () => {
    // Two tall pixels 40 m apart. The one south of the centre is real canopy; the one
    // south of *it* carries the same byte over a pixel the model never populated.
    // Only the first may cast, and the second must not — a raster full of blank
    // bytes read as heights would paint shade nobody can stand in.
    const real = CENTRE + 10;
    const blank = CENTRE + 20;
    const patch = patchAround(
      MADRID,
      (col, row) => (col === CENTRE && (row === real || row === blank) ? TREE_M : 0),
      (_col, row) => (row === blank ? 0 : 1),
    );
    const field = createCanopyHeightField(patch);

    expect(field.validFraction).toBeCloseTo((SIZE - 1) / SIZE, 10);
    expect(field.maxHeightM).toBe(TREE_M);

    const shade = field.shadeFor(0, Math.PI / 4, JULY);
    // 12 m north of the real tree, which sits 20 m south of the centre.
    expect(shade.opacityAt(...offset(-8))).toBeGreaterThan(0);
    // The same offset from the blank one, where nothing is known to stand.
    expect(shade.opacityAt(...offset(-28))).toBe(0);
  });

  it("marches over a hole rather than stopping at it", () => {
    // A blank column between the tree and the ground it shades. The march must cross
    // it: treating nodata as the end of the evidence would lose a real shadow.
    const patch = patchAround(
      MADRID,
      (col, row) => (col === CENTRE && row === CENTRE ? TREE_M : 0),
      (_col, row) => (row === CENTRE - 2 ? 0 : 1),
    );
    const shade = createCanopyHeightField(patch).shadeFor(0, Math.PI / 4, JULY);
    expect(shade.opacityAt(...offset(12))).toBeGreaterThan(0);
  });

  it("calls a fully valid patch fully valid without allocating a mask", () => {
    expect(createCanopyHeightField(oneTallPixel()).validFraction).toBe(1);
  });
});

describe("canopy height field — footprint subtraction", () => {
  /** A square building ring `halfM` metres each side of the patch centre. */
  function ringAround(halfM: number): Array<[number, number]> {
    const nw = offset(halfM, -halfM);
    const se = offset(-halfM, halfM);
    return [
      [nw[0], nw[1]],
      [se[0], nw[1]],
      [se[0], se[1]],
      [nw[0], se[1]],
      [nw[0], nw[1]],
    ];
  }

  it("removes canopy the building already stands on", () => {
    const field = createCanopyHeightField(oneTallPixel());
    const masked = field.masked([{ ring: ringAround(6) }]);

    expect(field.maxHeightM).toBe(TREE_M);
    expect(masked.maxHeightM).toBe(0);
    expect(masked.shadeFor(0, Math.PI / 4, JULY).opacityAt(...offset(12))).toBe(0);
  });

  it("leaves canopy outside the footprint alone", () => {
    // Two trees 40 m apart; the building covers only the southern one.
    const south = CENTRE + 10;
    const patch = patchAround(MADRID, (col, row) =>
      col === CENTRE && (row === CENTRE || row === south) ? TREE_M : 0,
    );
    const masked = createCanopyHeightField(patch).masked([
      { ring: [...ringAround(6)].map(([lng, lat]) => [lng, lat - 20 / 111195] as [number, number]) },
    ]);

    expect(masked.maxHeightM).toBe(TREE_M);
    expect(masked.shadeFor(0, Math.PI / 4, JULY).opacityAt(...offset(12))).toBeGreaterThan(0);
  });

  it("hands back the same field when there is nothing to subtract", () => {
    const field = createCanopyHeightField(oneTallPixel());
    expect(field.masked([])).toBe(field);
  });

  it("rasterises one building set once", () => {
    const field = createCanopyHeightField(oneTallPixel());
    const footprints = [{ ring: ringAround(6) }];
    expect(field.masked(footprints)).toBe(field.masked(footprints));
  });
});

describe("canopy height field — the crown model it shares with A7", () => {
  it("starts the shadow at the crown base, not at the ground", () => {
    const shade = createCanopyHeightField(oneTallPixel()).shadeFor(0, Math.PI / 4, JULY);
    // At 45° the shadow band runs from `base` to `height` metres north.
    const baseM = TREE_M * CROWN_BASE_FRACTION;
    expect(shade.opacityAt(...offset(baseM - 3))).toBe(0);
    expect(shade.opacityAt(...offset(baseM + 4))).toBeGreaterThan(0);
  });
});

// ─── Through `ShadowField`, over real pixels ──────────────────────────────────

describe("a raster patch through the shadow field", () => {
  /** Wide enough to contain a route bbox padded by `QUERY_PAD_M` at both ends. */
  const WIDE = 801;
  const WIDE_CENTRE = (WIDE - 1) / 2;

  /** The moment, and the sun the whole scene is built around. */
  const WHEN = JULY;
  const sun = SunCalc.getPosition(WHEN, MADRID[1], MADRID[0]);

  /**
   * A 40 m block of 20 m canopy, placed so its shadow lands on the patch centre.
   *
   * `buildShadowIndex` displaces a caster's shadow by `(sin az, cos az) × h/tan(alt)`,
   * and a crown casts from its base to its top — so a block sitting the mid-band
   * distance back along that vector throws its shadow over the origin. Deriving the
   * position from the sun rather than hard-coding it is what makes this a test of
   * where the shadow goes rather than of one lucky date.
   */
  function withCanopyBlock(): CanopyPatch {
    const midBandM = ((TREE_M * CROWN_BASE_FRACTION + TREE_M) / 2) / Math.tan(sun.altitude);
    const eastM = -Math.sin(sun.azimuth) * midBandM;
    const northM = -Math.cos(sun.azimuth) * midBandM;
    const centreCol = WIDE_CENTRE + Math.round(eastM / RES_M);
    const centreRow = WIDE_CENTRE - Math.round(northM / RES_M);
    const halfPixels = 10; // 40 m across, at 2 m a pixel

    return patchAround(
      MADRID,
      (col, row) =>
        Math.abs(col - centreCol) <= halfPixels && Math.abs(row - centreRow) <= halfPixels
          ? TREE_M
          : 0,
      undefined,
      WIDE,
    );
  }

  function fieldOver(patch: CanopyPatch) {
    const field = createCanopyHeightField(patch);
    const coverage: BBox = {
      west: patch.bbox[0], south: patch.bbox[1], east: patch.bbox[2], north: patch.bbox[3],
    };
    const provider: CanopyRasterProvider = {
      source: "canopy-raster",
      fieldFor: (bbox) => (bboxContains(coverage, bbox) ? field : null),
    };
    return createGeometryShadowField([], [], [provider]);
  }

  /** A 20 m edge at the patch centre, running east-west. */
  const edge: EdgeRef = { from: offset(0, -10), to: offset(0, 10) };

  it("shades an edge standing in the block's shadow, and labels it canopy", () => {
    const [shaded] = fieldOver(withCanopyBlock()).sampleEdges([edge], WHEN);

    expect(shaded.left).toBeGreaterThan(0.5);
    expect(shaded.right).toBeGreaterThan(0.5);
    // Below 1: a crown is not a wall, whatever the raster says about its height.
    expect(shaded.left).toBeLessThan(1);
    expect(shaded.source).toBe("canopy");
  });

  it("leaves the same edge in the sun when the raster holds no canopy", () => {
    const bare = patchAround(MADRID, () => 0, undefined, WIDE);
    const [sunlit] = fieldOver(bare).sampleEdges([edge], WHEN);

    expect(sunlit.left).toBe(0);
    // Nothing standing is knowledge, not evidence of canopy — so no canopy label.
    expect(sunlit.source).toBe("none");
  });
});

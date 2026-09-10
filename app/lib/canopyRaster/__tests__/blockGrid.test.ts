import { describe, expect, it } from "vitest";
import {
  blit,
  blocksForWindow,
  intersectWindows,
  runWindow,
  runsFor,
  tileExtent,
  worldFrameFor,
  worldWindowBbox,
} from "../blockGrid";
import { quadkeyFor, tileXYForQuadkey } from "../tiles";

/** The dataset's own tiling. Fixed by the publication, not a knob. */
const BLOCK = 512;

/**
 * The real Madrid tile's geotransform, as `tiles.test.ts` uses it — hard-coded so
 * the frame arithmetic is checked against the published grid without a fetch.
 */
const MADRID_TILE_BBOX: [number, number, number, number] = [
  -430493.34330211265, 4891969.81025128, -391357.5848201024, 4931105.568733291,
];

describe("intersectWindows", () => {
  it("returns the overlap of two windows", () => {
    expect(intersectWindows([0, 0, 10, 10], [5, 5, 20, 20])).toEqual([5, 5, 10, 10]);
  });

  it("returns null for windows that only touch along an edge", () => {
    expect(intersectWindows([0, 0, 10, 10], [10, 0, 20, 10])).toBeNull();
  });

  it("returns null for windows that miss entirely", () => {
    expect(intersectWindows([0, 0, 10, 10], [11, 11, 20, 20])).toBeNull();
  });
});

describe("blocksForWindow", () => {
  it("returns the single block a window inside one block touches", () => {
    expect(blocksForWindow([10, 10, 20, 20], BLOCK)).toEqual([{ col: 0, row: 0 }]);
  });

  it("does not claim the next block for a window ending exactly on the boundary", () => {
    // The window is right/bottom exclusive, so pixel 511 is the last one read and
    // block 1 contributes nothing. Rounding this the other way would fetch a
    // column of blocks down the whole edge of every viewport read.
    expect(blocksForWindow([0, 0, BLOCK, BLOCK], BLOCK)).toEqual([{ col: 0, row: 0 }]);
  });

  it("claims the next block for a window one pixel past the boundary", () => {
    expect(blocksForWindow([0, 0, BLOCK + 1, 1], BLOCK)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
  });

  it("walks the whole rectangle row-major, interior blocks included", () => {
    const blocks = blocksForWindow([100, 100, 3 * BLOCK, 2 * BLOCK], BLOCK);
    expect(blocks).toHaveLength(6);
    expect(blocks.slice(0, 3)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });
});

describe("runsFor", () => {
  it("merges consecutive columns in a row into one fetch", () => {
    const runs = runsFor([
      { col: 3, row: 7 },
      { col: 4, row: 7 },
      { col: 5, row: 7 },
    ]);
    expect(runs).toEqual([{ row: 7, firstCol: 3, lastCol: 5 }]);
  });

  it("splits on a gap rather than bridging blocks the cache already holds", () => {
    const runs = runsFor([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 4, row: 0 },
    ]);
    expect(runs).toEqual([
      { row: 0, firstCol: 0, lastCol: 1 },
      { row: 0, firstCol: 4, lastCol: 4 },
    ]);
  });

  it("never merges across rows, which are not consecutive on disk", () => {
    const runs = runsFor([
      { col: 0, row: 1 },
      { col: 0, row: 0 },
    ]);
    expect(runs).toEqual([
      { row: 0, firstCol: 0, lastCol: 0 },
      { row: 1, firstCol: 0, lastCol: 0 },
    ]);
  });

  it("is unbothered by unsorted or repeated input", () => {
    const runs = runsFor([
      { col: 2, row: 0 },
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(runs).toEqual([{ row: 0, firstCol: 0, lastCol: 2 }]);
  });
});

describe("runWindow", () => {
  it("covers whole blocks in the interior", () => {
    expect(runWindow({ row: 1, firstCol: 2, lastCol: 3 }, BLOCK, 4096, 4096)).toEqual([
      1024, 512, 2048, 1024,
    ]);
  });

  it("clamps the last block of a row to the image, which is where reads throw", () => {
    // A COG stores its edge blocks padded to a full 512; `readRasters` refuses a
    // window past the image, so the block that comes back is narrower.
    expect(runWindow({ row: 1, firstCol: 1, lastCol: 1 }, BLOCK, 700, 600)).toEqual([
      512, 512, 700, 600,
    ]);
  });
});

describe("blit", () => {
  it("places a source rectangle at its own offset in the destination", () => {
    const dst = new Uint8Array(4 * 4);
    const src = Uint8Array.from([1, 2, 3, 4]);
    blit(dst, 4, 4, 0, 0, src, 2, 2, 1, 1);
    expect([...dst]).toEqual([0, 0, 0, 0, 0, 1, 2, 0, 0, 3, 4, 0, 0, 0, 0, 0]);
  });

  it("copies only the overlap when the source hangs off the edge", () => {
    const dst = new Uint8Array(2 * 2);
    const src = Uint8Array.from([1, 2, 3, 4]);
    blit(dst, 2, 2, 0, 0, src, 2, 2, 1, 1);
    expect([...dst]).toEqual([0, 0, 0, 1]);
  });

  it("writes nothing when the rectangles do not meet", () => {
    const dst = new Uint8Array(4).fill(9);
    blit(dst, 2, 2, 0, 0, Uint8Array.from([1]), 1, 1, 5, 5);
    expect([...dst]).toEqual([9, 9, 9, 9]);
  });

  it("stitches two blocks into one raster with no seam", () => {
    // The failure this is here for is silent: an off-by-one origin produces a
    // plausible raster with a duplicated or dropped column at the join.
    const dst = new Uint8Array(4 * 1);
    blit(dst, 4, 1, 0, 0, Uint8Array.from([10, 11]), 2, 1, 0, 0);
    blit(dst, 4, 1, 0, 0, Uint8Array.from([12, 13]), 2, 1, 2, 0);
    expect([...dst]).toEqual([10, 11, 12, 13]);
  });
});

describe("worldFrameFor", () => {
  const [tileX, tileY] = tileXYForQuadkey(quadkeyFor(-3.7038, 40.4168));
  const frame = worldFrameFor(MADRID_TILE_BBOX, tileX, tileY, 16384);

  it("puts world pixel 0 at the north-west corner of the world", () => {
    const halfSpan = Math.PI * 6378137;
    expect(frame.originX).toBeCloseTo(-halfSpan, 3);
    expect(frame.originY).toBeCloseTo(halfSpan, 3);
  });

  it("derives the level resolution from the tile the file reported", () => {
    const span = MADRID_TILE_BBOX[2] - MADRID_TILE_BBOX[0];
    expect(frame.res).toBeCloseTo(span / 16384, 9);
  });

  it("places the tile back on its own bbox", () => {
    const extent = tileExtent(frame, tileX, tileY);
    const bbox = worldWindowBbox(extent, frame);
    // Round-tripping through lon/lat and back is the check that matters: the
    // whole point of the world frame is that a tile lands exactly where the COG
    // says it does.
    const [west, south, east, north] = bbox;
    expect(west).toBeCloseTo(-3.8671875, 6);
    expect(east).toBeCloseTo(-3.515625, 6);
    expect(north).toBeGreaterThan(south);
  });
});

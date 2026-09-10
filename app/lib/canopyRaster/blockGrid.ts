/**
 * The pixel arithmetic `CanopyTileStore` runs on: COG blocks, the runs a reader
 * fetches them in, and the composition that turns them back into one raster.
 *
 * Split from the store for the same reason `tiles.ts` is split from `canopyCog.ts`
 * — this is where the failures are silent. A wrong byte range throws; a wrong
 * block offset returns a plausible canopy raster shifted half a kilometre north,
 * and the only thing that catches it is arithmetic tested in `environment: "node"`
 * with no fixture and no fetch.
 *
 * **The frame.** Every window here is in *world pixels* at one overview level: the
 * zoom 10 tile grid multiplied by that level's per-tile width, origin at the
 * north-west corner of the world. One frame for the whole area of interest is what
 * makes a multi-tile read a stitch rather than a mosaic — tile-local windows would
 * leave the caller reconciling four different origins and a seam wherever they
 * disagreed by a pixel.
 */

import { type LonLatBbox, type PixelWindow, mercatorToLonLat } from "./tiles";

/** One block of a COG's internal tiling, within one published quadkey. */
export interface BlockCoord {
  col: number;
  row: number;
}

/** A block-row's worth of consecutive blocks, which is one fetch. */
export interface BlockRun {
  row: number;
  firstCol: number;
  /** Inclusive. */
  lastCol: number;
}

/** The overlap of two pixel windows, or `null` when they do not touch. */
export function intersectWindows(a: PixelWindow, b: PixelWindow): PixelWindow | null {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

/** Every block of the COG's own tiling that a pixel window touches, row-major. */
export function blocksForWindow(window: PixelWindow, blockSize: number): BlockCoord[] {
  const firstCol = Math.floor(window[0] / blockSize);
  const lastCol = Math.floor((window[2] - 1) / blockSize);
  const firstRow = Math.floor(window[1] / blockSize);
  const lastRow = Math.floor((window[3] - 1) / blockSize);

  const blocks: BlockCoord[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      blocks.push({ col, row });
    }
  }
  return blocks;
}

/**
 * Group blocks into consecutive runs along a block row — one fetch each.
 *
 * A COG stores its blocks row-major, so consecutive columns are consecutive byte
 * ranges and `geotiff` merges them into one request. Asking block by block would
 * be the same bytes in ten times the requests, against a host A8a already watched
 * return 504s under load. Splitting on a gap matters just as much in the other
 * direction: bridging two cached blocks would re-fetch what the store already has,
 * which is the whole thing this checkpoint exists to stop.
 */
export function runsFor(blocks: BlockCoord[]): BlockRun[] {
  const byRow = new Map<number, number[]>();
  for (const { col, row } of blocks) {
    const cols = byRow.get(row);
    if (cols) cols.push(col);
    else byRow.set(row, [col]);
  }

  const runs: BlockRun[] = [];
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const cols = [...new Set(byRow.get(row))].sort((a, b) => a - b);
    let firstCol = cols[0];
    let lastCol = cols[0];
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] === lastCol + 1) {
        lastCol = cols[i];
        continue;
      }
      runs.push({ row, firstCol, lastCol });
      firstCol = cols[i];
      lastCol = cols[i];
    }
    runs.push({ row, firstCol, lastCol });
  }
  return runs;
}

/**
 * The pixel window a run covers, clamped to the image.
 *
 * Clamping is what makes the edge blocks of a COG readable at all: the last block
 * of a row is stored padded to a full 512 pixels, but `readRasters` refuses a
 * window running past the image, so the block that comes back is narrower than
 * `blockSize` and has to be remembered as such.
 */
export function runWindow(
  run: BlockRun,
  blockSize: number,
  imageWidth: number,
  imageHeight: number,
): PixelWindow {
  return [
    run.firstCol * blockSize,
    run.row * blockSize,
    Math.min(imageWidth, (run.lastCol + 1) * blockSize),
    Math.min(imageHeight, (run.row + 1) * blockSize),
  ];
}

/**
 * Copy the overlapping part of one rectangle into another.
 *
 * Both rectangles carry their own origin in a shared frame, so the caller never
 * computes an offset: a block knows where it sits in world pixels, the output
 * knows where it starts, and this works out the rest. Rows are copied whole with
 * `set`, so a block landing fully inside the output costs one `memcpy` per row.
 */
export function blit(
  dst: Uint8Array,
  dstWidth: number,
  dstHeight: number,
  dstOriginX: number,
  dstOriginY: number,
  src: ArrayLike<number>,
  srcWidth: number,
  srcHeight: number,
  srcOriginX: number,
  srcOriginY: number,
): void {
  const overlap = intersectWindows(
    [dstOriginX, dstOriginY, dstOriginX + dstWidth, dstOriginY + dstHeight],
    [srcOriginX, srcOriginY, srcOriginX + srcWidth, srcOriginY + srcHeight],
  );
  if (!overlap) return;

  const [x0, y0, x1, y1] = overlap;
  const spanWidth = x1 - x0;
  for (let y = y0; y < y1; y++) {
    const srcStart = (y - srcOriginY) * srcWidth + (x0 - srcOriginX);
    const dstStart = (y - dstOriginY) * dstWidth + (x0 - dstOriginX);
    if (src instanceof Uint8Array) {
      dst.set(src.subarray(srcStart, srcStart + spanWidth), dstStart);
    } else {
      for (let i = 0; i < spanWidth; i++) dst[dstStart + i] = src[srcStart + i];
    }
  }
}

/**
 * What a world-pixel window covers on the ground.
 *
 * The world frame is defined by one already-opened COG: its own bounding box, the
 * tile indices its quadkey names, and the width of the level being read. Deriving
 * the origin from the file rather than from `2 * PI * R` keeps this honest if the
 * dataset is ever republished on a grid that is a pixel off from the ideal one.
 */
export interface WorldFrame {
  /** EPSG:3857 metres at world pixel x = 0. */
  originX: number;
  /** EPSG:3857 metres at world pixel y = 0, i.e. the north edge. */
  originY: number;
  /** EPSG:3857 metres per pixel at this level. */
  res: number;
  /** Pixels across one published quadkey at this level. */
  tilePixels: number;
}

export function worldFrameFor(
  tileBbox: [number, number, number, number],
  tileX: number,
  tileY: number,
  tilePixels: number,
): WorldFrame {
  const span = tileBbox[2] - tileBbox[0];
  return {
    originX: tileBbox[0] - tileX * span,
    originY: tileBbox[3] + tileY * span,
    res: span / tilePixels,
    tilePixels,
  };
}

/** The lon/lat box a world-pixel window covers — never exactly the AOI asked for. */
export function worldWindowBbox(window: PixelWindow, frame: WorldFrame): LonLatBbox {
  const [west, north] = mercatorToLonLat(
    frame.originX + window[0] * frame.res,
    frame.originY - window[1] * frame.res,
  );
  const [east, south] = mercatorToLonLat(
    frame.originX + window[2] * frame.res,
    frame.originY - window[3] * frame.res,
  );
  return [west, south, east, north];
}

/** The world-pixel extent of one published quadkey at this level. */
export function tileExtent(frame: WorldFrame, tileX: number, tileY: number): PixelWindow {
  return [
    tileX * frame.tilePixels,
    tileY * frame.tilePixels,
    (tileX + 1) * frame.tilePixels,
    (tileY + 1) * frame.tilePixels,
  ];
}

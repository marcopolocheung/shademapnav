/**
 * A8a — reading the Meta/WRI canopy height map straight from the browser.
 *
 * This is a transport prototype. It fetches, decodes and measures; **nothing here
 * reaches `ShadowField`, routing or the renderer**, and nothing should until A8c
 * has answered whether the model reads buildings as canopy (#279). A8a's job is to
 * establish that a route-sized area of canopy heights is a few hundred kilobytes
 * and a few hundred milliseconds away from a page with no server, and to say what
 * it actually costs.
 *
 * **Why this reads `source.coop` and not Meta's own bucket.** Meta's S3 sends no
 * `Access-Control-Allow-Origin`, and `Range` is not a CORS-safelisted request
 * header, so every read preflights and every preflight fails — the browser cannot
 * touch `dataforgood-fb-data` at all. The Taylor Geospatial rebuild republishes the
 * identical objects (verified byte-for-byte over the Madrid tile) with CORS open
 * and ranges supported. A byte-range passthrough in `api/` is the shelved fallback
 * if that republication ever goes away (#280); it is insurance, not a build item.
 *
 * Full measurements and method: `docs/notes/canopy-raster-feasibility-2026-09-09.md`.
 */

import { type GeoTIFFImage, fromUrl } from "geotiff";
import {
  type LonLatBbox,
  type MercatorBbox,
  type PixelWindow,
  pixelWindowFor,
  quadkeysForBbox,
  selectOverview,
  windowBbox,
} from "./tiles";

/** Where the CORS-open republication of Meta's COGs lives. */
export const CANOPY_COG_BASE_URL = "https://data.source.coop/tge-labs/meta-chm-v2/chm";

/**
 * The resolution a pedestrian shade sampler asks for, in ground metres per pixel.
 *
 * The feasibility note puts the useful band at 2-2.5 m; 2.0 picks the 16384
 * overview (1.82 m on the ground at Madrid) rather than native 0.91 m, which would
 * cost 4x the bytes for detail that a 2 m route sample cannot use.
 */
export const TARGET_GROUND_RES_M = 2.0;

/**
 * `NewSubfileType` bit 2 — "this image is a transparency mask".
 *
 * The dataset ships a 1-bit validity mask beside the heights, at full resolution
 * and at every overview level. GDAL tags the mask overviews `1 | 4 = 5`, so a
 * filter on the reduced-resolution bit alone keeps them, and a mask decodes into a
 * clean array of ones that looks exactly like a plausible raster. This bit is what
 * separates the two, and it is the reason overview selection is not delegated to
 * `geotiff`'s own `readRasters({ resX })` — see `selectOverview`.
 */
const SUBFILE_TYPE_MASK_BIT = 4;

/** A decoded canopy height raster over one area of interest. */
export interface CanopyHeightRaster {
  /**
   * Canopy height in **whole metres**, row-major, north-west origin.
   *
   * `uint8` is the distributed product's own precision, not a quantisation applied
   * here: there is no sub-metre canopy height in v2 whatever v1's `_float` path
   * suggests. 0 means "no canopy detected", not "no data" — the validity mask is a
   * separate image this prototype does not read.
   */
  heights: Uint8Array;
  width: number;
  height: number;
  /** What the returned pixels actually cover, which is never exactly the AOI asked for. */
  bbox: LonLatBbox;
  /** Ground metres per pixel at the AOI's latitude. */
  metresPerPixel: number;
  /** The IFD index read, for the record. Full resolution is 0. */
  overviewIndex: number;
  quadkey: string;
}

/**
 * What one read cost.
 *
 * `payloadBytes` is the compressed size of exactly the COG tiles the window
 * overlaps — the floor a perfect reader would transfer. It is collected after the
 * read from entries `readRasters` has already resolved, so it costs no request of
 * its own. The wire figure is
 * deliberately *not* here: it belongs to whoever supplies `fetch`, because only a
 * counting `fetch` sees block alignment, range merging and the header walk. The
 * benchmark pairs the two, and the gap between them is what A8b's tile store is
 * for.
 */
export interface CanopyReadStats {
  /** Compressed bytes of the COG tiles overlapping the window. */
  payloadBytes: number;
  /** COG tiles overlapping the window. */
  tilesRead: number;
  /**
   * Size of the whole `.tif`, which is what a naive read would have cost. Read
   * off the source after it has seen a `Content-Range`, so it is the server's
   * figure rather than a constant.
   */
  wholeTileBytes: number;
  /** Opening the file: the IFD chain walk, before any pixel is requested. */
  openMs: number;
  /** `readRasters` — the range fetches for the window plus decompression. */
  decodeMs: number;
  totalMs: number;
}

export interface ReadCanopyOptions {
  /** Ground metres per pixel to aim for. Defaults to `TARGET_GROUND_RES_M`. */
  targetGroundRes?: number;
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface CanopyReadResult {
  raster: CanopyHeightRaster;
  stats: CanopyReadStats;
}

/**
 * Read canopy heights over one area of interest, browser-direct.
 *
 * Rejects an AOI spanning more than one zoom 10 tile rather than answering for
 * part of it. Stitching tiles is A8b's `CanopyTileStore`, which has to dedupe and
 * cancel across two independent consumers (the viewport and the route corridor);
 * doing a corner of that job here would be the wrong half.
 */
export async function readCanopyHeights(
  aoi: LonLatBbox,
  options: ReadCanopyOptions = {},
): Promise<CanopyReadResult> {
  const { targetGroundRes = TARGET_GROUND_RES_M, baseUrl = CANOPY_COG_BASE_URL, signal } = options;

  const quadkeys = quadkeysForBbox(aoi);
  if (quadkeys.length !== 1) {
    throw new Error(
      `area of interest spans ${quadkeys.length} canopy tiles (${quadkeys.join(", ")}); multi-tile reads are A8b`,
    );
  }
  const quadkey = quadkeys[0];
  const centreLat = (aoi[1] + aoi[3]) / 2;

  const startedAt = now();
  const tiff = await fromUrl(`${baseUrl}/${quadkey}.tif`, {}, signal);

  // Image 0 is the only IFD carrying a geotransform; the overviews are plain
  // reduced-resolution subfiles covering the same extent, so every level's
  // resolution is derived from this bbox and its own width.
  const fullImage = await tiff.getImage(0);
  const tileBbox = fullImage.getBoundingBox() as MercatorBbox;
  const tileMercatorSpan = tileBbox[2] - tileBbox[0];

  const imageCount = await tiff.getImageCount();
  const candidates = [];
  for (let index = 0; index < imageCount; index++) {
    const image = await tiff.getImage(index);
    const subfileType = (image.fileDirectory.getValue("NewSubfileType") as number | undefined) ?? 0;
    if ((subfileType & SUBFILE_TYPE_MASK_BIT) !== 0) continue;
    candidates.push({ index, width: image.getWidth() });
  }
  const openMs = now() - startedAt;

  const overview = selectOverview(candidates, tileMercatorSpan, centreLat, targetGroundRes);
  const image = await tiff.getImage(overview.index);
  const window = pixelWindowFor(aoi, tileBbox, image.getWidth(), image.getHeight());

  const decodeStartedAt = now();
  const rasters = await image.readRasters({ window, signal });
  const decodeMs = now() - decodeStartedAt;

  const band = Array.isArray(rasters) ? rasters[0] : rasters;
  if (!(band instanceof Uint8Array)) {
    throw new Error(
      `expected a uint8 canopy band, got ${(band as ArrayLike<number>).constructor?.name ?? typeof band}`,
    );
  }

  const payload = await payloadBytesFor(image, window);

  return {
    raster: {
      heights: band,
      width: window[2] - window[0],
      height: window[3] - window[1],
      bbox: windowBbox(window, tileBbox, image.getWidth(), image.getHeight()),
      metresPerPixel: overview.groundRes,
      overviewIndex: overview.index,
      quadkey,
    },
    stats: {
      payloadBytes: payload.bytes,
      tilesRead: payload.tiles,
      wholeTileBytes: tiff.source.fileSize ?? 0,
      openMs,
      decodeMs,
      totalMs: now() - startedAt,
    },
  };
}

/**
 * The compressed size of the COG tiles a window overlaps.
 *
 * This is the number the feasibility note's 41 KB / 260 KB / 1.4 MB estimates were
 * summed from, recomputed here for the window actually read so the estimate and
 * the measurement are the same quantity.
 */
async function payloadBytesFor(
  image: GeoTIFFImage,
  window: PixelWindow,
): Promise<{ bytes: number; tiles: number }> {
  const tileWidth = image.getTileWidth();
  const tileHeight = image.getTileHeight();
  const tilesAcross = Math.ceil(image.getWidth() / tileWidth);
  let bytes = 0;
  let tiles = 0;
  const firstCol = Math.floor(window[0] / tileWidth);
  const lastCol = Math.floor((window[2] - 1) / tileWidth);
  const firstRow = Math.floor(window[1] / tileHeight);
  const lastRow = Math.floor((window[3] - 1) / tileHeight);
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      // Indexed, not `loadValue("TileByteCounts")`. The whole-array form calls
      // `loadAll()`, which `readRasters` never does — it resolves entries one at
      // a time — so asking for the array costs an extra round trip and 4 KB, and
      // those land inside the benchmark's own byte counters. Called after the
      // read, every entry needed here is already resolved and this fetches
      // nothing.
      const count = await image.fileDirectory.loadValueIndexed(
        "TileByteCounts",
        row * tilesAcross + col,
      );
      bytes += Number(count ?? 0);
      tiles += 1;
    }
  }
  return { bytes, tiles };
}

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

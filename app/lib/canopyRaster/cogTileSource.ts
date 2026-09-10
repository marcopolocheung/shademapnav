/**
 * The `geotiff.js` half of `CanopyTileStore` — one published COG, opened once and
 * read block-aligned.
 *
 * The store above it owns every policy (what to cache, what to dedupe, when to
 * retry, what to cancel) and this owns none of them, which is what lets the store's
 * behaviour be tested in `environment: "node"` against a fake source with no
 * network. Everything here is a thin translation of the COG's own structure.
 *
 * The one judgement it does make is reading the **validity mask** alongside the
 * heights. A8a read only the height band, where `0` means "no canopy detected" and
 * a nodata stamp looks exactly the same; A8c's histogram argued from the shape of
 * the distribution that building interiors are model output rather than blanked,
 * and said plainly that was evidence and not proof. The mask is the proof, it costs
 * almost nothing (1 bit per pixel, deflated, over an image that is nearly all
 * ones), and the consumer that needs it is the one being built on top of this.
 */

import { type GeoTIFF, type GeoTIFFImage, fromUrl } from "geotiff";
import { CANOPY_COG_BASE_URL, listCanopyLevels } from "./canopyCog";
import type { MercatorBbox, OverviewCandidate, PixelWindow } from "./tiles";

/** The block grid of one overview level. */
export interface LevelGrid {
  width: number;
  height: number;
  /** The COG's internal tiling — 512 in this dataset, read off the file regardless. */
  blockSize: number;
}

/** Heights and validity over one pixel window, row-major, north-west origin. */
export interface CanopyWindowPixels {
  /** Canopy height in whole metres. `0` is "no canopy", not "no data". */
  heights: Uint8Array;
  /**
   * `1` where the model produced an answer, `0` where the raster is blank.
   *
   * `null` means every pixel in the window is valid, which is the ordinary case
   * over land and worth not allocating a megabyte to say.
   */
  valid: Uint8Array | null;
}

/** One published zoom 10 COG, opened. */
export interface CanopyTileHandle {
  quadkey: string;
  /** The geotransform, in EPSG:3857 metres. Every level covers this same extent. */
  tileBbox: MercatorBbox;
  /** Height levels only — the mask IFDs are paired internally and never selectable. */
  levels: OverviewCandidate[];
  grid(levelIndex: number): Promise<LevelGrid>;
  read(
    levelIndex: number,
    window: PixelWindow,
    signal?: AbortSignal,
  ): Promise<CanopyWindowPixels>;
}

/** Where `CanopyTileStore` gets its tiles. Faked wholesale in the store's tests. */
export interface CanopyTileSource {
  open(quadkey: string, signal?: AbortSignal): Promise<CanopyTileHandle>;
}

export function createCogTileSource(opts: { baseUrl?: string } = {}): CanopyTileSource {
  const baseUrl = opts.baseUrl ?? CANOPY_COG_BASE_URL;

  return {
    async open(quadkey, signal) {
      const tiff = await fromUrl(`${baseUrl}/${quadkey}.tif`, {}, signal);
      const { tileBbox, heights, masks } = await listCanopyLevels(tiff);
      return createHandle(tiff, quadkey, tileBbox, heights, masks);
    },
  };
}

function createHandle(
  tiff: GeoTIFF,
  quadkey: string,
  tileBbox: MercatorBbox,
  heights: OverviewCandidate[],
  masks: OverviewCandidate[],
): CanopyTileHandle {
  return {
    quadkey,
    tileBbox,
    levels: heights,

    async grid(levelIndex) {
      const image = await tiff.getImage(levelIndex);
      const blockSize = image.getTileWidth();
      if (image.getTileHeight() !== blockSize) {
        // Everything downstream indexes a square block grid. The published
        // dataset is tiled 512x512; a strip-organised republication would need a
        // different reader, and should say so here rather than read the wrong rows.
        throw new Error(
          `canopy COG ${quadkey} level ${levelIndex} is tiled ${blockSize}x${image.getTileHeight()}, not square`,
        );
      }
      return { width: image.getWidth(), height: image.getHeight(), blockSize };
    },

    async read(levelIndex, window, signal) {
      const image = await tiff.getImage(levelIndex);
      const heights = await readBand(image, window, signal);

      // Paired by width, never by index: the published IFD order is image 0, its
      // mask, the height overviews, then their masks, so the mask of a level sits
      // at no fixed offset from it. See `listCanopyLevels`.
      const level = findByWidth(masks, image.getWidth());
      if (!level) return { heights, valid: null };

      const maskImage = await tiff.getImage(level.index);
      const raw = await readBand(maskImage, window, signal);
      return { heights, valid: normaliseMask(raw) };
    },
  };
}

function findByWidth(
  levels: OverviewCandidate[],
  width: number,
): OverviewCandidate | undefined {
  return levels.find((level) => level.width === width);
}

async function readBand(
  image: GeoTIFFImage,
  window: PixelWindow,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const rasters = await image.readRasters({ window, signal });
  const band = Array.isArray(rasters) ? rasters[0] : rasters;
  if (!(band instanceof Uint8Array)) {
    throw new Error(
      `expected a uint8 band, got ${(band as ArrayLike<number>).constructor?.name ?? typeof band}`,
    );
  }
  return band;
}

/**
 * Reduce a decoded mask to 0/1, and to `null` when it is entirely valid.
 *
 * The 1-bit mask arrives as ones or as 255s depending on how the level was
 * written, and over most of the world it is uniformly set — so the scan pays for
 * itself the moment it lets a block hold heights alone instead of twice its size.
 */
function normaliseMask(raw: Uint8Array): Uint8Array | null {
  let allValid = true;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      allValid = false;
      break;
    }
  }
  if (allValid) return null;

  const valid = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) valid[i] = raw[i] === 0 ? 0 : 1;
  return valid;
}

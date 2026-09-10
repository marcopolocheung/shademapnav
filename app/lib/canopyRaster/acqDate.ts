/**
 * When was the imagery behind a patch of canopy actually taken?
 *
 * This matters more than a provenance nicety, and the feasibility note says why:
 * **Madrid's tile is 2020-02 imagery — winter, in a city planted with deciduous
 * planes.** A canopy-height model reading bare crowns under-detects exactly the
 * canopy A7 exists to find, and it does so silently, because the raster reports a
 * height and never a confidence. Multiplying `canopy.ts`'s leaf-on transmittance
 * onto a winter-derived crown extent would be wrong twice over. A8c cannot check
 * that without knowing the date, so A8a has to make the date cheap.
 *
 * **It was not cheap, and it was not reachable.** The dates live in
 * `metadata/<quadkey>.geojson` next to each COG — 4.7 MB (Kent), 8.3 MB (Madrid)
 * and 24.4 MB (Singapore) for four, four and thirty polygons. Two measurements
 * settle what to do:
 *
 * - **The dates are not what is large.** Every feature's `properties` in a tile
 *   sum to 105-781 bytes. The imagery footprint outlines are 99.997% of the file:
 *   198k coordinate pairs for Madrid, 586k for Singapore. There is nothing to
 *   stream or paginate — the payload is a shape nobody needs at runtime.
 * - **A browser cannot fetch them at all.** `source.coop` republishes `chm/` and
 *   not `metadata/`, which 404s there, and Meta's own bucket sends no CORS
 *   headers. Unlike the COGs, this is not a size problem that a range read fixes.
 *
 * So the dates are resolved once, offline, by `scripts/canopy-acq-index.mjs`, and
 * shipped as a run-length-encoded 128x128 grid of date indices per tile:
 * **37.4 MB of GeoJSON becomes a 9,822-byte file**, at a measured 0.17-1.90%
 * disagreement against a 4x finer rasterization of the same polygons.
 *
 * The grid has one honest limit, measured by `--report`: a footprint smaller than
 * one ~306 m cell paints no cell, so `acquisitionDatesIn` can list a date that
 * `acquisitionAt` will never return. Two of Singapore's thirty footprints are in
 * that position — 26 dates listed, 24 reachable.
 *
 * **One tile is not one date**, which is why this is a grid and not a field on a
 * tile record. Singapore's single tile is a mosaic of 30 footprints spanning
 * 2015-01 to 2019-10; a `CanopyTile { observationDate }` shape would be wrong
 * there by up to five years.
 *
 * Only the three A3 corpus tiles are indexed. Indexing the world is a
 * preprocessing pipeline, and whether Umbra wants one is A8b/A8c's call.
 */

import index from "./acqDateIndex.json";
import { CANOPY_TILE_ZOOM, lonLatToMercator, quadkeyFor } from "./tiles";

interface IndexedTile {
  /** Distinct acquisition dates in the tile, ascending. `runs` holds indices into this. */
  dates: string[];
  /** `[runLength, dateIndex]` pairs over the row-major grid; -1 is "no imagery footprint". */
  runs: number[][];
}

const tiles = index.tiles as Record<string, IndexedTile>;

/** Expanded grids, built on first use. A tile's grid is 16 KB; three is not worth evicting. */
const expanded = new Map<string, Int16Array>();

export interface CanopyAcquisition {
  /** ISO date of the source imagery, e.g. `"2020-02-19"`. */
  date: string;
  /** The zoom 10 canopy tile the point falls in. */
  quadkey: string;
}

/** Whether this build carries an acquisition-date index for a point's tile. */
export function hasAcquisitionIndex(lon: number, lat: number): boolean {
  return quadkeyFor(lon, lat, CANOPY_TILE_ZOOM) in tiles;
}

/**
 * The imagery acquisition date covering a point, or `null`.
 *
 * `null` means "this build does not know", which is a different thing from "no
 * imagery" — an unindexed tile and a genuine gap in the mosaic both return it.
 * Callers that are about to reason about season must treat `null` as unknown
 * rather than as a licence to assume leaf-on.
 */
export function acquisitionAt(lon: number, lat: number): CanopyAcquisition | null {
  const quadkey = quadkeyFor(lon, lat, CANOPY_TILE_ZOOM);
  const tile = tiles[quadkey];
  if (!tile) return null;

  const grid = gridFor(quadkey, tile);
  const size = index.gridSize;
  const [minX, minY, maxX, maxY] = tileMercatorBbox(quadkey);
  const [x, y] = lonLatToMercator(lon, lat);

  const col = Math.floor(((x - minX) / (maxX - minX)) * size);
  const row = Math.floor(((maxY - y) / (maxY - minY)) * size);
  if (col < 0 || col >= size || row < 0 || row >= size) return null;

  const dateIndex = grid[row * size + col];
  if (dateIndex < 0) return null;
  return { date: tile.dates[dateIndex], quadkey };
}

/**
 * Every acquisition date present in an indexed tile, ascending.
 *
 * This is the truth about the *tile*, not the set `acquisitionAt` can return: a
 * footprint smaller than one grid cell is in this list and on no cell. Use it to
 * describe a tile's imagery span, not to enumerate answers.
 */
export function acquisitionDatesIn(quadkey: string): string[] {
  return tiles[quadkey]?.dates ?? [];
}

function gridFor(quadkey: string, tile: IndexedTile): Int16Array {
  const cached = expanded.get(quadkey);
  if (cached) return cached;

  const size = index.gridSize;
  const grid = new Int16Array(size * size);
  let at = 0;
  for (const [length, value] of tile.runs) {
    grid.fill(value, at, at + length);
    at += length;
  }
  expanded.set(quadkey, grid);
  return grid;
}

/**
 * The EPSG:3857 bbox of a quadkey, from the quadkey alone.
 *
 * Derived rather than read off a COG header on purpose: a date lookup must not
 * depend on having opened an 84 MB file.
 */
function tileMercatorBbox(quadkey: string): [number, number, number, number] {
  let x = 0;
  let y = 0;
  const zoom = quadkey.length;
  for (let i = 0; i < zoom; i++) {
    const mask = 1 << (zoom - i - 1);
    const digit = Number(quadkey[i]);
    if (digit & 1) x |= mask;
    if (digit & 2) y |= mask;
  }
  const span = (2 * Math.PI * 6378137) / 2 ** zoom;
  const originX = -Math.PI * 6378137;
  const originY = Math.PI * 6378137;
  return [
    originX + x * span,
    originY - (y + 1) * span,
    originX + (x + 1) * span,
    originY - y * span,
  ];
}

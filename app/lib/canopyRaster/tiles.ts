/**
 * Web Mercator, zoom-10 quadkeys and COG overview selection for the Meta/WRI
 * canopy height map.
 *
 * Everything here is arithmetic over numbers the COG's header already reports, so
 * it is separated from the network shell in `canopyCog.ts` and tested in
 * `environment: "node"` with no fixture and no fetch. The reason to keep the split
 * sharp is that the two failure modes are completely different: a wrong byte range
 * fails loudly, and a wrong *pixel window* returns plausible heights for the wrong
 * street.
 *
 * The dataset's grid is fixed and documented in
 * `docs/notes/canopy-raster-feasibility-2026-09-09.md`: one 32768x32768 GeoTIFF per
 * zoom-10 quadkey, EPSG:3857, tiled 512x512, seven overview levels.
 */

/** Web Mercator sphere radius, metres. EPSG:3857's defining constant. */
const EARTH_RADIUS_M = 6378137;

/** The dataset publishes one COG per zoom-10 quadkey. Not a tuning knob. */
export const CANOPY_TILE_ZOOM = 10;

/** Latitude beyond which Web Mercator is undefined for tiling purposes. */
const MERCATOR_MAX_LAT = 85.0511287798066;

/** `[west, south, east, north]` in degrees. */
export type LonLatBbox = [number, number, number, number];

/** `[minX, minY, maxX, maxY]` in EPSG:3857 metres. */
export type MercatorBbox = [number, number, number, number];

export function lonLatToMercator(lon: number, lat: number): [number, number] {
  const clamped = Math.min(MERCATOR_MAX_LAT, Math.max(-MERCATOR_MAX_LAT, lat));
  const x = (EARTH_RADIUS_M * lon * Math.PI) / 180;
  const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return [x, y];
}

export function mercatorToLonLat(x: number, y: number): [number, number] {
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

/**
 * The Bing/Web-Mercator quadkey naming each published COG: `chm/<quadkey>.tif`.
 *
 * Standard XYZ tile indices folded into a base-4 string, most significant zoom
 * level first. Madrid's corpus centre lands in `0331110121`, which is the tile
 * every measurement in the feasibility note was taken over.
 */
export function quadkeyFor(lon: number, lat: number, zoom: number = CANOPY_TILE_ZOOM): string {
  const clamped = Math.min(MERCATOR_MAX_LAT, Math.max(-MERCATOR_MAX_LAT, lat));
  const n = 2 ** zoom;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const latRad = (clamped * Math.PI) / 180;
  const yFraction = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  const y = Math.min(n - 1, Math.max(0, Math.floor(yFraction * n)));

  let quadkey = "";
  for (let level = zoom; level > 0; level--) {
    const mask = 1 << (level - 1);
    let digit = 0;
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    quadkey += String(digit);
  }
  return quadkey;
}

/**
 * The distinct zoom-10 quadkeys an area of interest touches.
 *
 * A8a reads one tile. This exists so the reader can *say* when a bbox straddles
 * two, rather than silently answering for the corner it happened to sample —
 * spanning tiles is `CanopyTileStore`'s job (A8b), not a thing to paper over here.
 */
export function quadkeysForBbox(bbox: LonLatBbox, zoom: number = CANOPY_TILE_ZOOM): string[] {
  const [west, south, east, north] = bbox;
  const corners: Array<[number, number]> = [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
  ];
  const seen = new Set<string>();
  for (const [lon, lat] of corners) seen.add(quadkeyFor(lon, lat, zoom));
  return [...seen];
}

/**
 * Ground metres per pixel at a latitude, given a Web Mercator resolution.
 *
 * Mercator metres are not ground metres away from the equator, and the gap is
 * large enough to matter: the dataset's native 1.19 mercator m/px is 0.91 m on the
 * ground at Madrid and 1.19 m at Singapore. Selecting an overview against the
 * mercator figure would hand a route sampler a different resolution in every city.
 */
export function groundResolution(mercatorRes: number, latitude: number): number {
  return mercatorRes * Math.cos((latitude * Math.PI) / 180);
}

/** One IFD of the COG, reduced to what overview selection needs. */
export interface OverviewCandidate {
  /** Index to pass to `GeoTIFF.getImage`. */
  index: number;
  /** Pixels across. The tile is square, so this fixes the resolution. */
  width: number;
}

export interface SelectedOverview extends OverviewCandidate {
  /** EPSG:3857 metres per pixel. */
  mercatorRes: number;
  /** Metres per pixel on the ground at the requested latitude. */
  groundRes: number;
}

/**
 * The overview to read for a target ground resolution.
 *
 * **The coarsest level that is still no coarser than the target.** Asking for
 * 2.0 m at Madrid picks the 16384 level (1.82 m) rather than full resolution
 * (0.91 m): one level finer than needed costs 4x the pixels and roughly 4x the
 * bytes for detail a pedestrian sampler throws away. If every level is coarser
 * than the target — a target under the native resolution — the finest is used,
 * because that is the best the dataset can answer with.
 *
 * `geotiff`'s own `readRasters({ bbox, resX })` cannot be used for this. It admits
 * any IFD whose `NewSubfileType` has the reduced-resolution bit set, and GDAL
 * writes the *mask* overviews as `1 | 4 = 5` — so its candidate list contains
 * seven 1-bit all-ones mask levels interleaved with the height levels, and its
 * selection loop stops on the first level *finer* than the request. Asking it for
 * 1.8 m over this file returns full resolution; a slightly different request
 * returns a mask, which decodes cleanly and is entirely ones. Both failures are
 * silent, which is why selection is explicit here and the mask IFDs are filtered
 * out by `NewSubfileType & 4` in `canopyCog.ts`.
 */
export function selectOverview(
  candidates: OverviewCandidate[],
  tileMercatorSpan: number,
  latitude: number,
  targetGroundRes: number,
): SelectedOverview {
  if (candidates.length === 0) {
    throw new Error("canopy COG exposes no height images");
  }
  const withRes = candidates
    .map((c) => {
      const mercatorRes = tileMercatorSpan / c.width;
      return {
        ...c,
        mercatorRes,
        groundRes: groundResolution(mercatorRes, latitude),
      };
    })
    // Coarsest first, so the first acceptable level is also the cheapest.
    .sort((a, b) => b.groundRes - a.groundRes);

  return withRes.find((c) => c.groundRes <= targetGroundRes) ?? withRes[withRes.length - 1];
}

/** A pixel window `[x0, y0, x1, y1]`, right/bottom exclusive, as `readRasters` wants. */
export type PixelWindow = [number, number, number, number];

/**
 * The pixel window covering an area of interest, clamped to the image.
 *
 * Outward-rounded: a window that rounded inward would drop the strip of canopy
 * along the requested edge, and a route corridor is mostly edge.
 */
export function pixelWindowFor(
  aoi: LonLatBbox,
  tileBbox: MercatorBbox,
  imageWidth: number,
  imageHeight: number,
): PixelWindow {
  const [minX, minY, maxX, maxY] = tileBbox;
  const resX = (maxX - minX) / imageWidth;
  const resY = (maxY - minY) / imageHeight;
  const [aoiMinX, aoiMinY] = lonLatToMercator(aoi[0], aoi[1]);
  const [aoiMaxX, aoiMaxY] = lonLatToMercator(aoi[2], aoi[3]);

  const clampX = (v: number) => Math.min(imageWidth, Math.max(0, v));
  const clampY = (v: number) => Math.min(imageHeight, Math.max(0, v));

  const x0 = clampX(Math.floor((aoiMinX - minX) / resX));
  const x1 = clampX(Math.ceil((aoiMaxX - minX) / resX));
  // Raster rows run north to south, so the window's top edge is the AOI's north.
  const y0 = clampY(Math.floor((maxY - aoiMaxY) / resY));
  const y1 = clampY(Math.ceil((maxY - aoiMinY) / resY));

  if (x1 <= x0 || y1 <= y0) {
    throw new Error("area of interest does not overlap the canopy tile");
  }
  return [x0, y0, x1, y1];
}

/** The lon/lat bbox a pixel window actually covers — never exactly the AOI asked for. */
export function windowBbox(
  window: PixelWindow,
  tileBbox: MercatorBbox,
  imageWidth: number,
  imageHeight: number,
): LonLatBbox {
  const [minX, minY, maxX, maxY] = tileBbox;
  const resX = (maxX - minX) / imageWidth;
  const resY = (maxY - minY) / imageHeight;
  const [west, north] = mercatorToLonLat(minX + window[0] * resX, maxY - window[1] * resY);
  const [east, south] = mercatorToLonLat(minX + window[2] * resX, maxY - window[3] * resY);
  return [west, south, east, north];
}

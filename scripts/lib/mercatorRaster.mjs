/**
 * Web Mercator arithmetic and a scanline polygon fill, shared by the offline
 * canopy studies.
 *
 * Extracted from `canopy-acq-index.mjs` when A8c needed the same fill for a
 * second job. The two callers rasterize different things onto different grids —
 * imagery footprints onto a 128x128 tile grid, building footprints onto the CHM's
 * own pixel window — but "which cells of a Mercator grid does this lon/lat ring
 * cover" is one operation, and having two copies of it would let the geometry
 * drift between the index Umbra ships and the study that judges the dataset.
 *
 * Node only. Nothing under `app/` imports this.
 */

/** Web Mercator sphere radius, metres. EPSG:3857's defining constant. */
export const EARTH_RADIUS_M = 6378137;

/** Latitude beyond which Web Mercator is undefined for tiling purposes. */
const MERCATOR_MAX_LAT = 85.0511287798066;

export function mercatorX(lon) {
  return (EARTH_RADIUS_M * lon * Math.PI) / 180;
}

export function mercatorY(lat) {
  const clamped = Math.min(MERCATOR_MAX_LAT, Math.max(-MERCATOR_MAX_LAT, lat));
  return EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}

/** The EPSG:3857 bbox of a quadkey, derived from the quadkey alone. */
export function tileMercatorBbox(quadkey) {
  let x = 0;
  let y = 0;
  const zoom = quadkey.length;
  for (let i = 0; i < zoom; i++) {
    const mask = 1 << (zoom - i - 1);
    const digit = Number(quadkey[i]);
    if (digit & 1) x |= mask;
    if (digit & 2) y |= mask;
  }
  const n = 2 ** zoom;
  const span = (2 * Math.PI * EARTH_RADIUS_M) / n;
  const originX = -Math.PI * EARTH_RADIUS_M;
  const originY = Math.PI * EARTH_RADIUS_M;
  return [
    originX + x * span,
    originY - (y + 1) * span,
    originX + (x + 1) * span,
    originY - y * span,
  ];
}

/**
 * Scanline fill of a lon/lat ring set onto a `width` x `height` Mercator raster,
 * even-odd, north-up. `paint` is called with the row-major cell index.
 *
 * Per row rather than per cell: a cell-by-cell point-in-polygon over Singapore's
 * 586k metadata vertices would be 16384 x 586086 edge tests. This is one pass over
 * the edges per row.
 *
 * Cells are sampled at their centres, which is what makes the two callers
 * comparable: a footprint smaller than one cell paints nothing rather than
 * rounding up to one.
 */
export function rasterizeRings(rings, bbox, width, height, paint) {
  const [minX, minY, maxX, maxY] = bbox;
  const cellX = (maxX - minX) / width;
  const cellY = (maxY - minY) / height;

  for (let row = 0; row < height; row++) {
    // Sample at the row's centre, in mercator y (north-up).
    const y = maxY - (row + 0.5) * cellY;
    const crossings = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        const y1 = mercatorY(lat1);
        const y2 = mercatorY(lat2);
        if (y1 === y2) continue;
        if (y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
        const t = (y - y1) / (y2 - y1);
        crossings.push(mercatorX(lon1) + t * (mercatorX(lon2) - mercatorX(lon1)));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil((crossings[i] - minX) / cellX - 0.5));
      const to = Math.min(width - 1, Math.floor((crossings[i + 1] - minX) / cellX - 0.5));
      for (let col = from; col <= to; col++) paint(row * width + col);
    }
  }
}

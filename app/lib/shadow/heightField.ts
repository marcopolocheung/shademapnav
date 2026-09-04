/** Physical tolerance used when comparing a surface with the shadow ceiling. */
export const SHADOW_HEIGHT_BIAS_M = 0.05;

/**
 * Convert the fixed metre tolerance into the cached height field's [0, 1] scale.
 *
 * `maxHeightM` is the cache's `maxH`, which every producer already clamps to a
 * positive value (`prismsFromTileFeatures`, `prismsFromFootprints`, and the empty
 * cache all floor it at 1), so this does not re-check it — it runs once per frame
 * inside the custom layer's render.
 */
export function normalizedShadowHeightBias(maxHeightM: number): number {
  return SHADOW_HEIGHT_BIAS_M / maxHeightM;
}

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

/**
 * Height the ceiling threshold must rise by when the field is sampled
 * `sunwardOffsetM` metres toward the sun, in the field's [0, 1] scale.
 *
 * Inside any caster's shadow the ceiling is affine along the sun direction with
 * the same slope `tan(alt)`, so the relation survives the per-pixel MAX the field
 * is built with: `ceiling(P + sunHat·d) = ceiling(P) + d·tan(alt)`. Sampling `d`
 * sunward and comparing against a threshold raised by this amount is therefore
 * exactly equivalent to sampling at `P` — which is what lets the wall pass nudge
 * its sample out of its own footprint without moving where the shadow lands.
 *
 * The result is linear in the offset, so a caller combining several offsets can
 * call this once per constant and combine the results.
 *
 * No clamp on `tan(alt)` is needed at either end: as the sun reaches the horizon
 * the lift goes to zero with it, and as it reaches the zenith every wall faces
 * away from it and is shaded by facing alone, whatever the lift says.
 */
export function normalizedCeilingLift(
  sunwardOffsetM: number,
  sunAltitudeRad: number,
  maxHeightM: number,
): number {
  return (sunwardOffsetM * Math.tan(sunAltitudeRad)) / maxHeightM;
}

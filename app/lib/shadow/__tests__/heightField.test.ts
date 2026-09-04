import { describe, expect, it } from "vitest";
import { SHADOW_HEIGHT_BIAS_M, normalizedShadowHeightBias } from "../heightField";

/** What the RGBA8 height field could represent, one 1/255 step per level. */
function quantize8(value: number): number {
  return Math.round(value * (2 ** 8 - 1)) / (2 ** 8 - 1);
}

/** What the DEPTH_COMPONENT24 ceiling texture represents. */
function quantize24(value: number): number {
  return Math.round(value * (2 ** 24 - 1)) / (2 ** 24 - 1);
}

/** The normalized slack the shaders used before the tolerance became metric. */
const LEGACY_NORMALIZED_BIAS = 0.004;

/**
 * The regression: a 20 m rooftop object on a 17 m roof, in a scene whose tallest
 * cached building is 541 m. Both shaders treat "ceiling <= surface + bias" as the
 * surface shading itself and drop the shadow, so the caster has to survive both
 * quantization and the bias to be drawn at all.
 */
const MAX_H_M = 541;
const CASTER_M = 20;
const RECEIVER_M = 17;

describe("normalizedShadowHeightBias", () => {
  it("loses the rooftop shadow under the old 8-bit field and normalized bias", () => {
    const ceiling = quantize8(CASTER_M / MAX_H_M);
    const surface = RECEIVER_M / MAX_H_M;

    // 3 m of real clearance, erased: 8 bits over 541 m is a ~2.1 m step, and the
    // fixed 0.004 was another ~2.2 m on top of it.
    expect(ceiling).toBeLessThanOrEqual(surface + LEGACY_NORMALIZED_BIAS);
  });

  it("keeps the rooftop shadow under the 24-bit field and the metric bias", () => {
    const ceiling = quantize24(CASTER_M / MAX_H_M);
    const surface = RECEIVER_M / MAX_H_M;

    expect(ceiling).toBeGreaterThan(surface + normalizedShadowHeightBias(MAX_H_M));
  });

  it("still classifies an equal-height caster and receiver as self-shadow", () => {
    const ceiling = quantize24(CASTER_M / MAX_H_M);
    const surface = CASTER_M / MAX_H_M;

    expect(ceiling).toBeLessThanOrEqual(surface + normalizedShadowHeightBias(MAX_H_M));
  });

  it("resolves a 10 cm step, which the old scheme could not", () => {
    const ceiling = quantize24((RECEIVER_M + 0.1) / MAX_H_M);
    const surface = RECEIVER_M / MAX_H_M;

    expect(ceiling).toBeGreaterThan(surface + normalizedShadowHeightBias(MAX_H_M));
    expect(quantize8((RECEIVER_M + 0.1) / MAX_H_M)).toBeLessThanOrEqual(
      surface + LEGACY_NORMALIZED_BIAS,
    );
  });

  it.each([1, 20, 541, 1_000])(
    "represents five centimetres when the tallest cached building is %s m",
    (maxHeightM) => {
      expect(normalizedShadowHeightBias(maxHeightM) * maxHeightM).toBeCloseTo(
        SHADOW_HEIGHT_BIAS_M,
        12,
      );
    },
  );

  it("tightens as the tallest cached building grows, unlike a fixed normalized bias", () => {
    // The old constant meant ~0.08 m of slack in a low-rise scene and ~2.2 m next
    // to a skyscraper; the metric one is 0.05 m in both.
    expect(normalizedShadowHeightBias(20)).toBeGreaterThan(normalizedShadowHeightBias(541));
    expect(LEGACY_NORMALIZED_BIAS * 541).toBeGreaterThan(2);
    expect(normalizedShadowHeightBias(541) * 541).toBeCloseTo(0.05, 12);
  });
});

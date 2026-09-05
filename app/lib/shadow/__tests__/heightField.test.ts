import { describe, expect, it } from "vitest";
import {
  SHADOW_HEIGHT_BIAS_M,
  normalizedCeilingLift,
  normalizedShadowHeightBias,
} from "../heightField";

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

/**
 * The wall pass samples the ceiling field a metre or two *toward the sun* to escape
 * its own footprint, where the field saturates at the caster's own roofline. Moving
 * toward the sun means closer to every caster, so the sampled ceiling rises — and
 * the threshold it is compared against has to rise by the same amount or the wall
 * shades higher than the ground shadow at its base says it should.
 */
describe("normalizedCeilingLift", () => {
  /**
   * One caster of height `H`, footprint at `x <= 0`, with `x` measured along the
   * ground *away* from the sun. Past the footprint the ceiling falls at `tan(alt)`;
   * over it the field saturates at the roofline — the near cap the nudge escapes.
   */
  const H = 80;
  const ceilingAt = (x: number, alt: number): number =>
    x <= 0 ? H : Math.min(H, Math.max(0, H - x * Math.tan(alt)));

  const ALTS = [10, 20, 33, 45, 70].map((deg) => (deg * Math.PI) / 180);
  /** The two nudge constants and their diagonal sum. */
  const OFFSETS = [1.5, 2.25, 3];
  /** Fractions of the shadow's length to place the surface point at. */
  const FRACTIONS = [0.2, 0.5, 0.8];

  /** How Pass E decides, having sampled the field `d` metres sunward of `x0`. */
  function shadedAfterNudge(x0: number, d: number, h: number, alt: number, lift: number) {
    return h / MAX_H_M + lift <= ceilingAt(x0 - d, alt) / MAX_H_M;
  }

  /** How the un-nudged ground pass decides at that same spot. */
  function shadedAtSurface(x0: number, h: number, alt: number) {
    return h <= ceilingAt(x0, alt);
  }

  /** Surface heights either side of the true terminator, none of them on it. */
  function probeHeights(ceiling: number, delta: number): number[] {
    return [ceiling - 1.5 * delta, ceiling - 0.5 * delta, ceiling + 0.5 * delta, ceiling + 1.5 * delta];
  }

  it("makes the nudged sample decide exactly what the un-nudged one would", () => {
    for (const alt of ALTS) {
      for (const d of OFFSETS) {
        const lift = normalizedCeilingLift(d, alt, MAX_H_M);
        for (const fraction of FRACTIONS) {
          const x0 = (fraction * H) / Math.tan(alt);
          if (x0 < d) continue; // the near cap, covered by its own test below
          const ceiling = ceilingAt(x0, alt);
          for (const h of probeHeights(ceiling, d * Math.tan(alt))) {
            expect(shadedAfterNudge(x0, d, h, alt, lift)).toBe(shadedAtSurface(x0, h, alt));
          }
        }
      }
    }
  });

  it("over-shades the wall without the lift, by the sunward step's worth of height", () => {
    const alt = (33 * Math.PI) / 180;
    const d = 1.5;
    const x0 = (0.5 * H) / Math.tan(alt);
    // A surface half a step above the true terminator: lit on the ground, shaded on
    // the wall. This is the step a shadow crossing from street to wall shows today.
    const h = ceilingAt(x0, alt) + 0.5 * d * Math.tan(alt);

    expect(shadedAtSurface(x0, h, alt)).toBe(false);
    expect(shadedAfterNudge(x0, d, h, alt, 0)).toBe(true);
    expect(shadedAfterNudge(x0, d, h, alt, normalizedCeilingLift(d, alt, MAX_H_M))).toBe(false);
  });

  it("bounds the residual to the step's height where the nudge stays inside the footprint", () => {
    for (const alt of ALTS) {
      for (const d of OFFSETS) {
        const lift = normalizedCeilingLift(d, alt, MAX_H_M);
        for (const x0 of [0, 0.25 * d, 0.75 * d]) {
          const ceiling = ceilingAt(x0, alt);
          for (const h of probeHeights(ceiling, d * Math.tan(alt))) {
            const nudged = shadedAfterNudge(x0, d, h, alt, lift);
            const truth = shadedAtSurface(x0, h, alt);
            if (nudged === truth) continue;
            // Under-shading only — never the lit-to-shaded direction — and confined
            // to a band one sunward step tall under the true terminator.
            expect([nudged, truth]).toEqual([false, true]);
            expect(ceiling - h).toBeLessThanOrEqual(d * Math.tan(alt));
          }
        }
      }
    }
  });

  it("vanishes with the sun on the horizon and grows as the sun climbs", () => {
    expect(normalizedCeilingLift(1.5, 0, MAX_H_M)).toBe(0);
    const lifts = ALTS.map((alt) => normalizedCeilingLift(1.5, alt, MAX_H_M));
    for (const [i, lift] of lifts.entries()) {
      expect(lift).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(lift).toBeGreaterThan(lifts[i - 1]);
    }
  });

  it("dwarfs the height tolerance the same shaders already model in metres", () => {
    const alt = (33 * Math.PI) / 180;
    for (const d of [1.5, 3]) {
      expect(normalizedCeilingLift(d, alt, MAX_H_M)).toBeGreaterThan(
        10 * normalizedShadowHeightBias(MAX_H_M),
      );
    }
  });
});

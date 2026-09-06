import type { Range, SkinType, SunDose, UserProfile } from "./types";

/**
 * Erythemal dose from a UV index, in SED per minute of full sun.
 *
 * One UV index unit is 25 mW/m² of erythemally weighted irradiance, and one SED is
 * 100 J/m². A minute at UVI `u` is therefore `u × 0.025 × 60 / 100` SED.
 * See docs/notes/heat-model.md.
 */
export const SED_PER_MINUTE_PER_UVI = 0.015;

/**
 * Minimal erythemal dose by Fitzpatrick phototype, in SED.
 *
 * **Treat every row as indicative, not as a threshold.** Fitzpatrick type predicts
 * measured MED at only r ≈ 0.5–0.69, the scale is self-reported and prone to recall
 * bias, and published MED figures come from solar simulators whose spectra do not
 * convert cleanly into erythemally weighted SED. This table is here so a future
 * profile feature has somewhere to start, not so the UI can quote a burn percentage.
 * See docs/notes/heat-model.md.
 */
export const MED_SED: Record<SkinType, Range> = {
  I: { low: 1.5, high: 2.5 },
  II: { low: 2.0, high: 3.0 },
  III: { low: 3.0, high: 4.0 },
  IV: { low: 4.0, high: 5.0 },
  V: { low: 5.0, high: 7.0 },
  VI: { low: 8.0, high: 12.0 },
};

/**
 * Share of ambient erythemal UV still reaching someone in building shade.
 *
 * **Shade is not a UV shield.** Under clear skies the diffuse component is about
 * 50–62% of global erythemal UV, so a building shadow removes the direct beam and
 * leaves most of the rest. What remains is that diffuse share multiplied by how much
 * sky the spot can still see, which for a street shaded by one building is high.
 *
 * The band below is that product for a plausible range of street geometries. It is a
 * derivation, not a measurement, and it is the least defensible number in this file —
 * Track A's sky view factor (A9) is what would replace it with something computed.
 */
export const SHADE_UV_TRANSMISSION: Range = { low: 0.2, high: 0.6 };

export interface TripExposure {
  sunMinutes: number;
  /** Minutes in shade. Not zero-dose — see `SHADE_UV_TRANSMISSION`. */
  shadeMinutes: number;
}

function widthRatio(range: Range): number {
  return range.low > 0 ? range.high / range.low : Infinity;
}

/**
 * UV dose for a trip, as an interval.
 *
 * Returns `null` when the UV index is unknown, rather than substituting a zero that
 * would render as a safe trip. A UV index of exactly 0 — night, or deep winter dusk —
 * is a real measurement and yields a real zero dose.
 *
 * Deliberately takes shaded minutes as well as sunlit ones. A function that counted
 * only direct sun would report a fully shaded route as zero dose, which is precisely
 * the claim this model must not make.
 *
 * `profile` has **no default, and null is a legitimate argument**. Without one the
 * result carries no `burnFraction`, because a burn percentage is a claim about a
 * person and this codebase must not invent one. That is a deliberate barrier: an
 * earlier draft defaulted to type II and produced a confident-looking "16–29% of a
 * burn" for a user nobody had asked.
 */
export function dose(
  exposure: TripExposure,
  uvIndex: number | null,
  profile: UserProfile | null = null
): SunDose | null {
  if (uvIndex === null || !Number.isFinite(uvIndex) || uvIndex < 0) return null;

  const sunMinutes = Math.max(0, exposure.sunMinutes);
  const shadeMinutes = Math.max(0, exposure.shadeMinutes);
  const perMinute = uvIndex * SED_PER_MINUTE_PER_UVI;

  const sed: Range = {
    low: perMinute * (sunMinutes + shadeMinutes * SHADE_UV_TRANSMISSION.low),
    high: perMinute * (sunMinutes + shadeMinutes * SHADE_UV_TRANSMISSION.high),
  };

  // The trip restated as unbroken full sun at the same UV — no person in it.
  const fullSunEquivalentMinutes: Range =
    perMinute > 0
      ? { low: sed.low / perMinute, high: sed.high / perMinute }
      : { low: 0, high: 0 };

  let burnFraction: Range | null = null;
  if (profile) {
    const med = MED_SED[profile.skinType];
    // Widest defensible interval: the smallest dose against the most tolerant
    // threshold, and the largest dose against the least tolerant one.
    burnFraction = { low: sed.low / med.high, high: sed.high / med.low };
  }

  const ratio = widthRatio(sed);
  const uncertainty = ratio <= 1.6 ? "low" : ratio <= 2.6 ? "medium" : "high";

  return { sed, fullSunEquivalentMinutes, burnFraction, uncertainty, method: "sed-uvi-v1" };
}

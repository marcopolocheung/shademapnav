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
 * Intervals rather than the single figures often quoted: published MED values for a
 * phototype disagree by roughly a factor of 1.5, and presenting one of them as *the*
 * threshold is the false precision this track is not allowed to show.
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
 * **Shade is not a UV shield.** Roughly half of ground-level erythemal UV arrives as
 * diffuse sky radiation, so a building shadow under open sky blocks the beam and
 * little else. This band is wide on purpose — it depends on how much sky the spot
 * can still see, which the app does not model until Track A's sky view factor (A9).
 */
export const SHADE_UV_TRANSMISSION: Range = { low: 0.2, high: 0.5 };

export const DEFAULT_PROFILE: UserProfile = { skinType: "II" };

export interface TripExposure {
  sunMinutes: number;
  /** Minutes in shade. Not zero-dose — see `SHADE_UV_TRANSMISSION`. */
  shadeMinutes: number;
}

function widthRatio(range: Range): number {
  return range.low > 0 ? range.high / range.low : Infinity;
}

/**
 * UV dose for a trip, as an interval a sun-sensitive person can act on.
 *
 * Returns `null` when the UV index is unknown, rather than substituting a zero that
 * would render as a safe trip. A UV index of exactly 0 — night, or deep winter dusk —
 * is a real measurement and yields a real zero dose.
 *
 * Deliberately takes shaded minutes as well as sunlit ones. A function that counted
 * only direct sun would report a fully shaded route as zero dose, which is precisely
 * the claim this model must not make.
 */
export function dose(
  exposure: TripExposure,
  uvIndex: number | null,
  profile: UserProfile = DEFAULT_PROFILE
): SunDose | null {
  if (uvIndex === null || !Number.isFinite(uvIndex) || uvIndex < 0) return null;

  const sunMinutes = Math.max(0, exposure.sunMinutes);
  const shadeMinutes = Math.max(0, exposure.shadeMinutes);
  const perMinute = uvIndex * SED_PER_MINUTE_PER_UVI;

  const sed: Range = {
    low: perMinute * (sunMinutes + shadeMinutes * SHADE_UV_TRANSMISSION.low),
    high: perMinute * (sunMinutes + shadeMinutes * SHADE_UV_TRANSMISSION.high),
  };

  const med = MED_SED[profile.skinType];
  // Widest defensible interval: the smallest dose against the most tolerant
  // threshold, and the largest dose against the least tolerant one.
  const burnFraction: Range = { low: sed.low / med.high, high: sed.high / med.low };

  const burnMinutes: Range | null =
    perMinute > 0 ? { low: med.low / perMinute, high: med.high / perMinute } : null;

  const ratio = Math.max(widthRatio(burnFraction), widthRatio(sed));
  const uncertainty = ratio <= 1.6 ? "low" : ratio <= 2.6 ? "medium" : "high";

  return { sed, burnFraction, burnMinutes, uncertainty, method: "sed-uvi-v1" };
}

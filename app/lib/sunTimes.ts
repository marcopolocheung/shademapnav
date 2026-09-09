import SunCalc from "suncalc";

/**
 * Sunrise and sunset, from the same solar model that draws the shadows.
 *
 * This exists because there were four hand-rolled copies of one low-precision
 * orbital model in this repo, none of them shared and none of them tested, while
 * `SunCalc` — accurate, already a dependency, already in the entry chunk — drove
 * the actual shadow layer. The marker on the timeline and the shadow under it
 * were computed by different code, and they disagreed by 14 minutes (#225).
 *
 * Returns **instants**, not clock minutes and not bearings, so each caller
 * formats for itself and this module never needs to know about timezones.
 */

/** Minutes of solar time per degree of longitude: 1440 / 360. */
const MIN_PER_DEGREE = 4;

/**
 * Local solar noon on the day containing `date` at this longitude.
 *
 * `SunCalc.getTimes` picks the solar day nearest the instant it is given, so the
 * instant matters: asked at 04:00 UTC and at 12:00 UTC on the same date, it
 * answers with sunrises a day apart for New York. Anchoring at local noon removes
 * that, and **longitude is the right frame to do it in** — which solar day a
 * moment belongs to is a question about where the sun is, not about what the
 * civil clock says. That is why this takes no UTC offset: it is correct even
 * where the two disagree by hours, as in western China.
 */
function solarNoonAnchor(date: Date, lngDeg: number): Date {
  const shiftMs = lngDeg * MIN_PER_DEGREE * 60000;
  const solar = new Date(date.getTime() + shiftMs);
  return new Date(
    Date.UTC(solar.getUTCFullYear(), solar.getUTCMonth(), solar.getUTCDate(), 12) - shiftMs
  );
}

/**
 * Sunrise and sunset for the solar day containing `date`, or `null` where the sun
 * neither rises nor sets — polar day and polar night both.
 *
 * SunCalc reports both of those as an invalid `Date` rather than throwing, and
 * callers already treat "no answer" as a reason to draw no marker, so the two
 * collapse into one `null` here.
 */
export function sunriseSunset(
  date: Date,
  latDeg: number,
  lngDeg: number
): { sunrise: Date; sunset: Date } | null {
  const { sunrise, sunset } = SunCalc.getTimes(solarNoonAnchor(date, lngDeg), latDeg, lngDeg);
  if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) return null;
  return { sunrise, sunset };
}

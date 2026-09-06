import { dose, DEFAULT_PROFILE } from "../lib/heat/dose";
import type { WeatherHour } from "../lib/heat/types";
import { routeExposureMinutes } from "../lib/routeTradeoff";
import type { RouteOption } from "../lib/routing";

const METHOD_URL =
  "https://github.com/marcopolocheung/shademapnav/blob/main/docs/notes/heat-model.md";

const SKIN_LABEL: Record<string, string> = {
  I: "very fair", II: "fair", III: "medium", IV: "olive", V: "brown", VI: "dark",
};

interface SunDoseLineProps {
  route?: RouteOption;
  /** The forecast hour at the map's location, or null when none is available. */
  weather: WeatherHour | null;
}

/**
 * What this trip costs your skin, as an interval with its method attached.
 *
 * Renders nothing at all when the UV index is unknown: a dose is the one number in
 * this app that must never be guessed, and an absent forecast is not a safe trip.
 */
export default function SunDoseLine({ route, weather }: SunDoseLineProps) {
  if (!route || route.partial) return null;

  const estimate = dose(routeExposureMinutes(route), weather?.uvIndex ?? null);
  if (!estimate) return null;

  const low = Math.round(estimate.burnFraction.low * 100);
  const high = Math.round(estimate.burnFraction.high * 100);
  const skin = SKIN_LABEL[DEFAULT_PROFILE.skinType];

  return (
    <div
      className="rounded-lg border px-3 py-2 shadow-lg backdrop-blur-xl"
      style={{ background: "rgba(255,255,255,0.86)", borderColor: "var(--md-outline-variant)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[10px] uppercase tracking-widest font-bold"
          style={{ color: "var(--md-on-surface-variant)" }}
        >
          UV {estimate.sed.high > 0 ? weather?.uvIndex?.toFixed(1) : "0"}
        </span>
        <a
          href={METHOD_URL}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] underline underline-offset-2"
          style={{ color: "var(--md-on-surface-variant)" }}
        >
          How this is estimated
        </a>
      </div>
      <div className="text-sm font-semibold leading-snug" style={{ color: "var(--md-on-surface)" }}>
        {low === high ? `${low}%` : `${low}–${high}%`} of a {skin}-skin burn
      </div>
      <div className="text-[10px] leading-snug" style={{ color: "var(--md-on-surface-variant)" }}>
        {estimate.sed.low.toFixed(1)}–{estimate.sed.high.toFixed(1)} SED, assuming skin type{" "}
        {DEFAULT_PROFILE.skinType} and unprotected skin. Shade counts too — it blocks the beam,
        not the diffuse sky.
      </div>
    </div>
  );
}

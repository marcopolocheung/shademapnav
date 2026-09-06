import { dose } from "../lib/heat/dose";
import type { WeatherHour } from "../lib/heat/types";
import { routeExposureMinutes } from "../lib/routeTradeoff";
import type { RouteOption } from "../lib/routing";

const METHOD_URL =
  "https://github.com/marcopolocheung/shademapnav/blob/main/docs/notes/heat-model.md";

/** "under a minute", "5 min", "4–5 min" — one unit on the end, not two. */
function formatMinuteRange(low: number, high: number): string {
  if (high < 1) return "under a minute";
  const lo = Math.round(low);
  const hi = Math.round(high);
  if (lo === hi) return `${hi} min`;
  return lo < 1 ? `under 1–${hi} min` : `${lo}–${hi} min`;
}

interface SunDoseLineProps {
  route?: RouteOption;
  /** The forecast hour at the map's location, or null when none is available. */
  weather: WeatherHour | null;
}

/**
 * What this trip is worth in UV, stated without inventing a person.
 *
 * Shows a full-sun equivalent rather than a share of a burn. A burn percentage needs
 * a minimal erythemal dose, and the only route to one is a Fitzpatrick phototype that
 * predicts measured MED at r ≈ 0.5–0.69 — under half the variance, from a self-reported
 * scale. That is not enough to put a number about someone's skin on their screen, so
 * this component deliberately does not, and `dose()` will not supply one without a
 * profile. See docs/notes/heat-model.md.
 *
 * Renders nothing when the UV index is unknown: an absent forecast is not a safe trip.
 */
export default function SunDoseLine({ route, weather }: SunDoseLineProps) {
  if (!route || route.partial) return null;

  const estimate = dose(routeExposureMinutes(route), weather?.uvIndex ?? null);
  if (!estimate) return null;

  const { low, high } = estimate.fullSunEquivalentMinutes;
  const equivalent = formatMinuteRange(low, high);

  return (
    <div
      className="rounded-lg border px-3 py-2 shadow-lg backdrop-blur-xl"
      style={{ background: "rgba(255,255,255,0.86)", borderColor: "var(--md-outline-variant)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span
            className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(100,116,139,0.14)", color: "var(--md-on-surface-variant)" }}
          >
            Experimental
          </span>
          <span
            className="text-[10px] uppercase tracking-widest font-bold"
            style={{ color: "var(--md-on-surface-variant)" }}
          >
            UV {weather?.uvIndex?.toFixed(1) ?? "—"}
          </span>
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
        About {equivalent} of full sun
      </div>
      <div className="text-[10px] leading-snug" style={{ color: "var(--md-on-surface-variant)" }}>
        {estimate.sed.low.toFixed(1)}–{estimate.sed.high.toFixed(1)} SED. Shade counts toward
        this — it blocks the direct beam, not the diffuse sky. Not a safe-exposure limit, and
        not advice about your skin.
      </div>
    </div>
  );
}

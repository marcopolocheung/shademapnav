import { heatScore } from "../lib/heat/score";
import type { WeatherHour } from "../lib/heat/types";
import { routeExposureMinutes } from "../lib/routeTradeoff";
import type { RouteOption } from "../lib/routing";

const METHOD_URL =
  "https://github.com/marcopolocheung/shademapnav/blob/main/docs/notes/heat-score.md";

interface RouteHeatLineProps {
  route: RouteOption;
  /** The shortest route, for comparison. Omitted when it is the selected one. */
  baselineRoute?: RouteOption;
  /** The forecast hour at the map's location, or null when none is available. */
  weather: WeatherHour | null;
}

/**
 * How hard the selected route is on a body, next to the same number for the shortest.
 *
 * A shade percentage compares routes; it does not tell you whether either is a good
 * idea right now. This puts the two options on one axis that moves with the weather:
 * at 18 °C the gap between them barely matters, at 34 °C it is most of the decision.
 *
 * The score is an intensity, not a dose — how hot the walk feels, not how long it
 * lasts. Its duration is the "+4 min" directly above it. See docs/notes/heat-score.md.
 */
export default function RouteHeatLine({ route, baselineRoute, weather }: RouteHeatLineProps) {
  const selected = heatScore(routeExposureMinutes(route), weather);
  const baseline =
    baselineRoute && baselineRoute !== route
      ? heatScore(routeExposureMinutes(baselineRoute), weather)
      : null;

  const detail =
    selected.mode === "felt-temperature"
      ? `feels about ${Math.round(selected.feltC as number)}\u00A0°C walking this`
      : "sun exposure only — no weather forecast";

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span
        className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full"
        style={{ background: "rgba(100,116,139,0.14)", color: "var(--md-on-surface-variant)" }}
      >
        Experimental
      </span>
      <span className="text-xs font-semibold" style={{ color: "var(--md-on-surface)" }}>
        Heat {selected.score}
        {baseline ? ` vs ${baseline.score}` : ""}
      </span>
      <span className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>
        {detail}
      </span>
      <a
        href={METHOD_URL}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] underline underline-offset-2 py-1"
        style={{ color: "var(--md-on-surface-variant)" }}
      >
        How this is scored
      </a>
    </div>
  );
}

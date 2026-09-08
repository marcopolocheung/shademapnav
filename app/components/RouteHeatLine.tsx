import { heatBand, heatScore } from "../lib/heat/score";
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
 *
 * With no forecast the row deliberately stops saying "Heat" at all. `heatScore` still
 * returns a number in that mode, but it is the sunlit percentage of the trip, on a
 * different scale entirely — reusing the same label for it would invite the reader to
 * compare 70%-in-sun against 70-on-the-UTCI-ramp.
 */
export default function RouteHeatLine({ route, baselineRoute, weather }: RouteHeatLineProps) {
  const selected = heatScore(routeExposureMinutes(route), weather);
  const baseline =
    baselineRoute && baselineRoute !== route
      ? heatScore(routeExposureMinutes(baselineRoute), weather)
      : null;

  const scored = selected.mode === "felt-temperature";
  const feltC = Math.round(selected.feltC ?? 0);

  const headline = scored
    ? heatBand(selected.score)
    : `${selected.score}% of this walk is in sun`;

  // Three rungs, three sentences. The middle one exists because a dry-bulb estimate
  // and an apparent-temperature one otherwise render identically, and the difference
  // is humidity and wind being absent from the number entirely.
  const detail = !scored
    ? "no weather forecast — heat not scored"
    : selected.inputs.ambientIsApparent
      ? `feels about ${feltC} °C walking this`
      : `about ${feltC} °C — air temperature only`;

  // One secondary sentence, not two rows: the card sits above the route options a
  // walker is actually choosing between, and every line it grows pushes them down.
  const secondary = scored
    ? `${baseline ? `Heat ${selected.score} vs ${baseline.score}` : `Heat ${selected.score}`} · ${detail}`
    : detail;

  return (
    // `aria-live="off"` overrides the polite region on the card above. The forecast
    // hour changes every ~1.5 s while the timeline is playing, and a live heat score
    // at that cadence is announcement spam rather than information.
    <div aria-live="off" className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-1.5">
        <span
          className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: "rgba(100,116,139,0.14)", color: "var(--md-on-surface-variant)" }}
        >
          Experimental
        </span>
        <span className="text-xs font-semibold" style={{ color: "var(--md-on-surface)" }}>
          {headline}
        </span>
      </div>
      <div className="text-xs leading-snug" style={{ color: "var(--md-on-surface-variant)" }}>
        {secondary}
        {/* Sighted readers get the antecedent from the "Shortest baseline" line two
            rows up; a screen reader hears two bare numbers with no direction. */}
        {scored && (
          <span className="sr-only">
            {baseline
              ? " Higher is hotter; the second number is the shortest route."
              : " out of 100. Higher is hotter."}
          </span>
        )}
      </div>
      <a
        href={METHOD_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="How this heat score is calculated (opens in a new tab)"
        className="inline-flex min-h-11 items-center self-start text-xs underline underline-offset-2"
        style={{ color: "var(--md-on-surface-variant)" }}
      >
        How this is scored
      </a>
    </div>
  );
}

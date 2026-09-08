import type { WeatherHour } from "../lib/heat/types";
import type { RouteOption } from "../lib/routing";
import { routeExposureLine, routeTradeoffLine } from "../lib/routeTradeoff";
import RouteHeatLine from "./RouteHeatLine";

interface RouteTradeoffSummaryProps {
  route?: RouteOption;
  baselineRoute?: RouteOption;
  /** The forecast hour at the map's location, or null when none is available. */
  weather?: WeatherHour | null;
}

export default function RouteTradeoffSummary({
  route,
  baselineRoute,
  weather = null,
}: RouteTradeoffSummaryProps) {
  if (!route || route.partial || !baselineRoute) return null;

  return (
    <div
      aria-live="polite"
      className="rounded-lg border border-l-2 px-3 py-2 shadow-lg backdrop-blur-xl"
      style={{
        background: "rgba(255,255,255,0.86)",
        borderColor: "var(--md-outline-variant)",
        borderLeftColor: "var(--md-primary)",
      }}
    >
      <div
        className="text-[10px] uppercase tracking-widest font-bold"
        style={{ color: "var(--md-on-surface-variant)" }}
      >
        Selected route
      </div>
      <div className="text-sm font-semibold leading-snug" style={{ color: "var(--md-primary)" }}>
        {routeTradeoffLine(route, baselineRoute)}
      </div>
      <div className="text-xs leading-snug" style={{ color: "var(--md-on-surface-variant)" }}>
        {routeExposureLine(route)}
      </div>
      <RouteHeatLine route={route} baselineRoute={baselineRoute} weather={weather} />
    </div>
  );
}

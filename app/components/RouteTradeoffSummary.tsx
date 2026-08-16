import type { RouteOption } from "../lib/routing";
import { routeTradeoffLine } from "../lib/routeTradeoff";

interface RouteTradeoffSummaryProps {
  route?: RouteOption;
  baselineRoute?: RouteOption;
}

export default function RouteTradeoffSummary({
  route,
  baselineRoute,
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
    </div>
  );
}

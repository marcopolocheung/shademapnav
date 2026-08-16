import type { RouteOption } from "../lib/routing";
import { shortestRoute } from "../lib/routeTradeoff";
import RouteCard from "./RouteCard";

interface FloatingRouteCardsProps {
  routes: RouteOption[];
  selectedRouteIndex: number;
  onSelectRoute: (i: number) => void;
  onSaveRoute?: (routeIndex: number) => void;
  onExportRoute?: (routeIndex: number, format: "gpx" | "geojson") => void;
  solarIntensity?: number | null;
  onStartNavigation?: () => void;
}

export default function FloatingRouteCards({
  routes,
  selectedRouteIndex,
  onSelectRoute,
  onSaveRoute,
  onExportRoute,
  solarIntensity,
  onStartNavigation,
}: FloatingRouteCardsProps) {
  if (routes.length === 0) return null;
  const baselineRoute = shortestRoute(routes);
  const completeBaselineRoute = shortestRoute(routes.filter((route) => !route.partial)) ?? baselineRoute;
  const selectedRoute = routes[selectedRouteIndex];

  return (
    <div className="hidden md:flex absolute right-6 top-20 bottom-24 w-80 z-30 flex-col gap-3 pointer-events-none">
      {/* Recommended badge */}
      <div className="flex items-center gap-2 pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest font-bold text-green-700">
          Recommended Option
        </span>
      </div>

      {/* Solar pill */}
      {solarIntensity != null && solarIntensity > 0.15 && (
        <div
          className="text-xs px-3 py-1.5 rounded-full self-start pointer-events-none"
          style={{
            background: solarIntensity > 0.6 ? "var(--md-primary-container)" : "rgba(255,171,0,0.12)",
            color: solarIntensity > 0.6 ? "var(--md-on-primary-container)" : "#92400e",
          }}
        >
          {solarIntensity > 0.6 ? "High solar load — shade matters" : "Moderate solar load"}
        </div>
      )}

      {/* Route cards */}
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto md-scrollbar pointer-events-auto" role="radiogroup" aria-label="Route options">
        {routes.map((r, i) => (
          <RouteCard
            key={i}
            route={r}
            selected={i === selectedRouteIndex}
            onSelect={() => onSelectRoute(i)}
            onSave={onSaveRoute ? () => onSaveRoute(i) : undefined}
            onExport={onExportRoute ? (fmt) => onExportRoute(i, fmt) : undefined}
            recommended={r.label === "Balanced"}
            baselineRoute={completeBaselineRoute ?? undefined}
          />
        ))}
      </div>

      {/* Start navigating */}
      {onStartNavigation && !selectedRoute?.partial && (
        <button
          onClick={onStartNavigation}
          className="w-full px-4 py-3 rounded-xl text-sm font-bold transition-colors pointer-events-auto shadow-lg"
          style={{ background: "#22c55e", color: "white" }}
        >
          START NAVIGATING
        </button>
      )}
    </div>
  );
}

import type { RouteOption } from "./routing";

const WALK_SPEED_MPS = 1.4;

function travelSeconds(route: RouteOption): number {
  return route.totalTimeSec ?? route.distanceM / WALK_SPEED_MPS;
}

function directSunMeters(route: RouteOption): number {
  return Math.max(0, route.distanceM * (1 - route.shadeCoverage));
}

function formatDeltaMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes <= 0) return "same time";
  return `+${minutes} min`;
}

export function routeTradeoffLine(route: RouteOption, baseline: RouteOption): string {
  if (route === baseline) {
    return `Shortest baseline, ${Math.round(route.shadeCoverage * 100)}% shade`;
  }

  const timeDeltaSec = Math.max(0, travelSeconds(route) - travelSeconds(baseline));
  const baselineSun = directSunMeters(baseline);
  const routeSun = directSunMeters(route);
  const sunDeltaPct = baselineSun > 0
    ? Math.round(((routeSun - baselineSun) / baselineSun) * 100)
    : 0;

  const sunLabel =
    sunDeltaPct < 0
      ? `${sunDeltaPct}% sun exposure`
      : sunDeltaPct > 0
        ? `+${sunDeltaPct}% sun exposure`
        : "same sun exposure";

  return `${formatDeltaMinutes(timeDeltaSec)}, ${sunLabel}`;
}

export function shortestRoute(routes: RouteOption[]): RouteOption | null {
  if (routes.length === 0) return null;
  return routes.reduce((best, route) =>
    travelSeconds(route) < travelSeconds(best) ? route : best
  );
}

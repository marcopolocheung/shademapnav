import type { RouteLeg } from "./routing";

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatMinutes(sec: number): string {
  return `${Math.max(1, Math.ceil(sec / 60))} min`;
}

function transitSunLabel(sunExposure: number | undefined): string | null {
  if (sunExposure == null) return null;
  if (sunExposure < 0.05) return "underground";
  if (sunExposure < 0.2) return "mostly shaded";
  return "some sun";
}

export interface RouteLegSummary {
  title: string;
  detail: string;
}

export function routeLegSummary(leg: RouteLeg, index: number): RouteLegSummary {
  if (leg.type === "transit") {
    const line = leg.lineName || leg.line || "Transit";
    const stopCount = leg.stops ? Math.max(0, leg.stops.length - 1) : null;
    const parts = [
      leg.travelTimeSec != null ? formatMinutes(leg.travelTimeSec) : null,
      stopCount != null ? `${stopCount} stop${stopCount === 1 ? "" : "s"}` : null,
      transitSunLabel(leg.sunExposure),
    ].filter(Boolean);

    return {
      title: `Leg ${index + 1}: ${line}`,
      detail: parts.length > 0 ? parts.join(" - ") : "Transit segment",
    };
  }

  const parts = [
    leg.distanceM != null ? formatDist(leg.distanceM) : null,
    leg.shadeCoverage != null ? `${Math.round(leg.shadeCoverage * 100)}% shade` : null,
  ].filter(Boolean);

  return {
    title: `Leg ${index + 1}: Walk`,
    detail: parts.length > 0 ? parts.join(" - ") : "Walking segment",
  };
}

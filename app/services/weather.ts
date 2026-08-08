interface OpenMeteoCloudCoverResponse {
  hourly?: {
    time?: string[];
    cloud_cover?: number[];
  };
}

export interface CloudCoverForecast {
  cloudCoverPct: number;
  forecastTime: Date;
}

const MAX_HOUR_DELTA_MS = 90 * 60 * 1000;

function parseUtcHour(raw: string): Date | null {
  const d = new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function nearestCloudCover(
  response: OpenMeteoCloudCoverResponse,
  target: Date
): CloudCoverForecast | null {
  const times = response.hourly?.time ?? [];
  const cloudCover = response.hourly?.cloud_cover ?? [];
  let best: CloudCoverForecast | null = null;
  let bestDelta = Infinity;

  for (let i = 0; i < times.length; i++) {
    const forecastTime = parseUtcHour(times[i]);
    const pct = cloudCover[i];
    if (!forecastTime || typeof pct !== "number" || !Number.isFinite(pct)) continue;
    const delta = Math.abs(forecastTime.getTime() - target.getTime());
    if (delta < bestDelta) {
      bestDelta = delta;
      best = {
        forecastTime,
        cloudCoverPct: Math.max(0, Math.min(100, Math.round(pct))),
      };
    }
  }

  return best && bestDelta <= MAX_HOUR_DELTA_MS ? best : null;
}

export async function fetchCloudCoverForecast(
  lat: number,
  lng: number,
  target: Date,
  signal?: AbortSignal
): Promise<CloudCoverForecast | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly: "cloud_cover",
    forecast_days: "7",
    past_days: "1",
    timezone: "UTC",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json() as OpenMeteoCloudCoverResponse;
  return nearestCloudCover(json, target);
}

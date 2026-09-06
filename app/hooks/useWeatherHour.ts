import { useEffect, useState } from "react";
import type { WeatherHour } from "../lib/heat/types";
import { fetchWeatherForecast, nearestWeatherHour } from "../services/weather";

/**
 * The forecast hour nearest the timeline, for wherever the map is looking.
 *
 * This is a second *read* of D2's cache, not a second request: the cloud badge has
 * already pulled the same location's week-long response, so a consumer that needs
 * temperature or UV costs nothing beyond the match. Coordinates are rounded to the
 * cache's own ~1.1 km cells and the target to the hour, so panning and dragging the
 * slider re-run this only when the answer could actually change.
 *
 * Null means "no forecast", never "no heat": every consumer has to keep working
 * with the network down, which is the D2 contract's whole point.
 */
export function useWeatherHour(
  center: [number, number] | null,
  date: Date
): WeatherHour | null {
  const [hour, setHour] = useState<WeatherHour | null>(null);

  const latKey = center ? center[0].toFixed(2) : null;
  const lngKey = center ? center[1].toFixed(2) : null;
  const targetMs = Math.round(date.getTime() / 3600000) * 3600000;

  useEffect(() => {
    if (!latKey || !lngKey) {
      setHour(null);
      return;
    }

    const ctrl = new AbortController();
    fetchWeatherForecast(Number(latKey), Number(lngKey), { signal: ctrl.signal })
      .then((hours) => setHour(nearestWeatherHour(hours, new Date(targetMs))))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setHour(null);
      });

    return () => ctrl.abort();
  }, [latKey, lngKey, targetMs]);

  return hour;
}

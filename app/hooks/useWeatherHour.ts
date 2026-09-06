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

    // Deliberately no AbortSignal. The promise this awaits is the *shared* cache
    // entry, so aborting it on cleanup cancels the fetch for every other consumer
    // and poisons the cached entry for the effect run that immediately replaces
    // this one — which showed up as the heat line stranded on "no forecast" after
    // a pan or a slider drag that crossed an hour boundary mid-fetch. Ignoring a
    // stale result is the correct cancellation here; the request is one the app
    // wanted anyway and is now cached.
    let current = true;
    fetchWeatherForecast(Number(latKey), Number(lngKey))
      .then((hours) => {
        if (current) setHour(nearestWeatherHour(hours, new Date(targetMs)));
      })
      .catch(() => {
        if (current) setHour(null);
      });

    return () => {
      current = false;
    };
  }, [latKey, lngKey, targetMs]);

  return hour;
}

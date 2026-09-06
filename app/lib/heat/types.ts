/**
 * The contract Track D publishes: one hour of weather, from one cached fetch,
 * shared by every consumer that needs more than a shade fraction.
 *
 * Every measured field is nullable, deliberately. Open-Meteo can omit a variable,
 * a cached response can predate a field being requested, and "absent" has to stay
 * distinguishable from "zero" — a dose computed from a fabricated `uvIndex: 0`
 * would read as a safe hour rather than an unknown one, which is exactly the
 * false confidence this track's honesty guardrail exists to prevent.
 */
export interface WeatherHour {
  time: Date;
  uvIndex: number | null;
  tempC: number | null;
  humidityPct: number | null;
  windMs: number | null;
  cloudPct: number | null;
  apparentTempC: number | null;
}

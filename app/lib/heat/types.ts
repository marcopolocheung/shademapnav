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

/** Fitzpatrick phototype. The only profile input D3 needs; D5 adds the rest. */
export type SkinType = "I" | "II" | "III" | "IV" | "V" | "VI";

export interface UserProfile {
  skinType: SkinType;
}

/** Every estimate this track shows is an interval, never a point value. */
export interface Range {
  low: number;
  high: number;
}

/**
 * A UV dose estimate for one trip. Ranges throughout, because the inputs are
 * ranges: published MED values for a phototype span a factor of ~1.5, and the
 * share of ambient UV that reaches you in building shade is a wider band still.
 */
export interface SunDose {
  /** Standard erythemal doses accumulated on this trip. 1 SED = 100 J/m². */
  sed: Range;
  /** That dose as a share of one minimal erythemal dose for this skin type. */
  burnFraction: Range;
  /** Minutes of *continued full sun* at this UV before one MED. Null in the dark. */
  burnMinutes: Range | null;
  uncertainty: "low" | "medium" | "high";
  /** Versioned so the UI can link to the method that produced this number. */
  method: "sed-uvi-v1";
}

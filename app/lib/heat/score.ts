import type { WeatherHour } from "./types";

/**
 * How much of the score's inputs were actually measured.
 *
 * `felt-temperature` folds air temperature, humidity, wind and solar radiation into
 * one estimated felt temperature for the trip. `shade-only` is what is left with no
 * usable forecast: the sunlit share of the trip, and nothing else. The two are not
 * comparable to each other, which is why the mode travels with the number and the UI
 * is expected to show it.
 */
export type HeatScoreMode = "felt-temperature" | "shade-only";

export interface HeatScore {
  /** 0–100. Ordinal: it ranks options at one hour and place, and measures nothing. */
  score: number;
  /**
   * Versioned so the UI can link to the method that produced this number.
   *
   * Track D's brief sketched this as `shade-uv-v1`. The model does not use UV — the
   * radiant load is scaled by shortwave irradiance instead, for the seasonal reason
   * in `SUN_FELT_C_PER_WM2` — and a version string naming the wrong variable is a
   * false trail through a health-adjacent number.
   */
  method: "shade-radiation-v1";
  mode: HeatScoreMode;
  /** The estimated felt temperature the score came from, or null in shade-only mode. */
  feltC: number | null;
  /** 0–1. How much of the model's inputs were measured rather than assumed. */
  confidence: number;
  inputs: {
    /** Share of the trip's minutes spent out of shade, 0–1. */
    sunFraction: number;
    sunMinutes: number;
    /** The ambient temperature used — apparent if available, else dry-bulb. */
    ambientC: number | null;
    ambientIsApparent: boolean;
    shortwaveWm2: number | null;
    /** Degrees added at full sun exposure, before the sunlit share scales it. */
    sunPenaltyC: number;
  };
}

export interface TripExposure {
  sunMinutes: number;
  /** Minutes in shade. Shade lowers the radiant load; it does not remove it. */
  shadeMinutes: number;
}

/**
 * Felt-temperature anchors, in °C, and the score each maps to.
 *
 * The temperatures are UTCI's published heat-stress category boundaries — no thermal
 * stress ends at 26, moderate at 32, strong at 38, very strong at 46 (Bröde et al.
 * 2012, as published by Copernicus). The scores attached to them are ours: an even
 * 20 points per category, chosen so the number is readable, not because anything says
 * a 60 is twice a 30. See docs/notes/heat-score.md.
 */
export const SCORE_ANCHORS: ReadonlyArray<readonly [feltC: number, score: number]> = [
  [9, 0],
  [26, 40],
  [32, 60],
  [38, 80],
  [46, 100],
];

/**
 * Degrees of felt temperature added per W/m² of global shortwave, at full exposure.
 *
 * Measured street-shade studies put the sun-vs-shade difference at roughly 3.1–6.3 °C
 * UTCI on hot summer days, when global shortwave near solar noon is on the order of
 * 900 W/m². Taking the middle of that band against that irradiance gives ~0.005 °C
 * per W/m², which is the constant below.
 *
 * It is a straight-line fit through one anchor point, not a published transfer
 * function — no study we could find reports ΔUTCI as a function of measured
 * irradiance. Linearity is the assumption; the anchor is measured. Scaling by
 * radiation rather than by UV index is the part that matters: the UV share of
 * shortwave more than doubles between January and June, so a UV-scaled penalty
 * would mis-rank the same street across seasons.
 */
export const SUN_FELT_C_PER_WM2 = 0.005;

/** No street-shade study we found reports a sun/shade UTCI gap wider than this. */
export const MAX_SUN_FELT_C = 6.5;

/**
 * Open-Meteo's apparent temperature carries its own solar term:
 * `0.70 × Q / (0.75·windMs + 10)` with `Q = 0.1 × max(0, shortwave − 550)`, from the
 * Steadman/BOM formula it implements. That term assumes the grid cell's radiation
 * reaches you, which for a shaded street is exactly the claim this app exists to
 * dispute — so it is removed before this model adds a shade-aware penalty of its own.
 */
const AT_SOLAR_CUTOFF_WM2 = 550;
const AT_SOLAR_ABSORPTION = 0.1;

function apparentSolarTermC(shortwaveWm2: number, windMs: number): number {
  const q = AT_SOLAR_ABSORPTION * Math.max(0, shortwaveWm2 - AT_SOLAR_CUTOFF_WM2);
  return (0.7 * q) / (0.75 * windMs + 10);
}

const CONFIDENCE = {
  /** Apparent temperature, with its own solar term identified and removed. */
  apparent: 0.6,
  /** Dry-bulb temperature: humidity and wind are not in the number at all. */
  dryBulb: 0.45,
  /** No forecast: the sunlit share of the trip is the whole model. */
  shadeOnly: 0.3,
} as const;

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Piecewise-linear interpolation through `SCORE_ANCHORS`, flat outside its ends. */
export function feltToScore(feltC: number): number {
  const first = SCORE_ANCHORS[0];
  const last = SCORE_ANCHORS[SCORE_ANCHORS.length - 1];
  if (feltC <= first[0]) return first[1];
  if (feltC >= last[0]) return last[1];

  for (let i = 1; i < SCORE_ANCHORS.length; i++) {
    const [hiC, hiScore] = SCORE_ANCHORS[i];
    if (feltC > hiC) continue;
    const [loC, loScore] = SCORE_ANCHORS[i - 1];
    const t = (feltC - loC) / (hiC - loC);
    return loScore + t * (hiScore - loScore);
  }
  return last[1];
}

/**
 * How hard one trip is on a body, as a 0–100 index.
 *
 * The score is an **intensity, not a dose**: it estimates the felt temperature while
 * walking and says nothing about how long the walk is. That is deliberate — the
 * trip's length and its minutes in sun are already on screen beside it, and folding
 * duration in would rank a long shaded walk worse than a short scorching one without
 * ever saying so.
 *
 * Sun exposure enters as a *share* of the trip's minutes, so a route half in sun takes
 * half the penalty. Humidity and wind enter through Open-Meteo's apparent temperature
 * rather than being recombined here, and its built-in radiation term is subtracted
 * first so the sun is not counted twice.
 *
 * With no usable forecast the result degrades to `shade-only` — the sunlit share and
 * nothing else — rather than assuming a temperature. `mode` says which happened.
 */
export function heatScore(
  exposure: TripExposure,
  weather: WeatherHour | null
): HeatScore {
  const sunMinutes = Math.max(0, exposure.sunMinutes);
  const shadeMinutes = Math.max(0, exposure.shadeMinutes);
  const total = sunMinutes + shadeMinutes;
  const sunFraction = total > 0 ? sunMinutes / total : 0;

  const shortwaveWm2 = Math.max(0, finite(weather?.shortwaveWm2) ?? Number.NaN);
  const apparentC = finite(weather?.apparentTempC);
  const dryBulbC = finite(weather?.tempC);
  const windMs = finite(weather?.windMs);
  const ambientC = apparentC ?? dryBulbC;

  // Apparent temperature is only usable when its solar term can be identified and
  // removed, which needs the same wind speed the formula divides by.
  const useApparent = apparentC !== null && windMs !== null;
  const shadeAmbientC = useApparent
    ? (apparentC as number) - apparentSolarTermC(shortwaveWm2, windMs as number)
    : dryBulbC;

  const sunPenaltyC = Number.isFinite(shortwaveWm2)
    ? Math.min(MAX_SUN_FELT_C, shortwaveWm2 * SUN_FELT_C_PER_WM2)
    : 0;

  const inputs = {
    sunFraction,
    sunMinutes,
    ambientC,
    ambientIsApparent: useApparent,
    shortwaveWm2: Number.isFinite(shortwaveWm2) ? shortwaveWm2 : null,
    sunPenaltyC,
  };

  if (shadeAmbientC === null || !Number.isFinite(shortwaveWm2)) {
    return {
      score: Math.round(sunFraction * 100),
      method: "shade-radiation-v1",
      mode: "shade-only",
      feltC: null,
      confidence: CONFIDENCE.shadeOnly,
      inputs,
    };
  }

  const feltC = shadeAmbientC + sunFraction * sunPenaltyC;

  return {
    score: Math.round(feltToScore(feltC)),
    method: "shade-radiation-v1",
    mode: "felt-temperature",
    feltC,
    confidence: useApparent ? CONFIDENCE.apparent : CONFIDENCE.dryBulb,
    inputs,
  };
}

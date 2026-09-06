import { describe, expect, it } from "vitest";
import {
  feltToScore,
  heatScore,
  MAX_SUN_FELT_C,
  SCORE_ANCHORS,
  SUN_FELT_C_PER_WM2,
} from "../heat/score";
import type { WeatherHour } from "../heat/types";

/** A hot clear midday: 34 °C apparent, light wind, near-peak sun. */
function weather(fields: Partial<WeatherHour> = {}): WeatherHour {
  return {
    time: new Date("2026-07-15T12:00:00Z"),
    uvIndex: 8,
    tempC: 31,
    humidityPct: 60,
    windMs: 2,
    cloudPct: 10,
    apparentTempC: 34,
    shortwaveWm2: 900,
    ...fields,
  };
}

const HALF_HOUR_IN_SUN = { sunMinutes: 30, shadeMinutes: 0 };
const HALF_HOUR_IN_SHADE = { sunMinutes: 0, shadeMinutes: 30 };

describe("feltToScore", () => {
  it("returns each anchor's score exactly at its temperature", () => {
    for (const [feltC, score] of SCORE_ANCHORS) {
      expect(feltToScore(feltC)).toBeCloseTo(score, 10);
    }
  });

  it("flattens outside the anchored range rather than extrapolating", () => {
    expect(feltToScore(-20)).toBe(0);
    expect(feltToScore(5)).toBe(0);
    expect(feltToScore(60)).toBe(100);
  });

  it("interpolates linearly between two anchors", () => {
    // Halfway from 32 °C / 60 to 38 °C / 80.
    expect(feltToScore(35)).toBeCloseTo(70, 10);
  });

  it("rises monotonically with felt temperature", () => {
    let previous = -1;
    for (let c = 0; c <= 50; c += 0.5) {
      const score = feltToScore(c);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });
});

describe("heatScore", () => {
  it("ranks a fully shaded route below a fully sunlit one at the same hour", () => {
    const sun = heatScore(HALF_HOUR_IN_SUN, weather());
    const shade = heatScore(HALF_HOUR_IN_SHADE, weather());

    expect(shade.score).toBeLessThan(sun.score);
    expect(shade.mode).toBe("felt-temperature");
    expect(sun.mode).toBe("felt-temperature");
  });

  it("scores a table of known conditions", () => {
    const cases: Array<[label: string, w: Partial<WeatherHour>, sunFraction: number, expected: number]> = [
      // Mild spring morning, 300 W/m²: the sun barely matters and the score says so.
      ["mild, shaded", { apparentTempC: 18, tempC: 17, windMs: 3, shortwaveWm2: 300 }, 0, 21],
      ["mild, half sun", { apparentTempC: 18, tempC: 17, windMs: 3, shortwaveWm2: 300 }, 0.5, 23],
      ["mild, sunlit", { apparentTempC: 18, tempC: 17, windMs: 3, shortwaveWm2: 300 }, 1, 25],
      // Hot clear midday: shade is worth 15 points.
      ["hot, shaded", {}, 0, 60],
      ["hot, half sun", {}, 0.5, 67],
      ["hot, sunlit", {}, 1, 75],
      // Heatwave: both options are bad, and the score does not pretend otherwise.
      ["extreme, shaded", { apparentTempC: 42, tempC: 40, windMs: 1, shortwaveWm2: 1000 }, 0, 83],
      ["extreme, sunlit", { apparentTempC: 42, tempC: 40, windMs: 1, shortwaveWm2: 1000 }, 1, 95],
    ];

    for (const [label, fields, sunFraction, expected] of cases) {
      const result = heatScore(
        { sunMinutes: 30 * sunFraction, shadeMinutes: 30 * (1 - sunFraction) },
        weather(fields)
      );
      expect(result.score, label).toBe(expected);
    }
  });

  it("removes the apparent temperature's own solar term before adding its own", () => {
    // Steadman adds 0.70 × 0.1 × (900 − 550) / (0.75 × 2 + 10) ≈ 2.13 °C of sun to
    // the 34 °C apparent temperature. A shaded walk should not be charged for it.
    const shaded = heatScore(HALF_HOUR_IN_SHADE, weather());

    expect(shaded.feltC as number).toBeCloseTo(31.87, 2);
    expect(shaded.feltC as number).toBeLessThan(34);
  });

  it("leaves apparent temperature alone below the formula's radiation cutoff", () => {
    const shaded = heatScore(
      HALF_HOUR_IN_SHADE,
      weather({ apparentTempC: 24, shortwaveWm2: 400 })
    );

    expect(shaded.feltC as number).toBeCloseTo(24, 10);
  });

  it("scales the sun penalty with radiation, not with UV index", () => {
    // Same UV index, half the radiation: a winter noon is not a summer noon.
    const summer = heatScore(HALF_HOUR_IN_SUN, weather({ uvIndex: 5, shortwaveWm2: 900 }));
    const winter = heatScore(HALF_HOUR_IN_SUN, weather({ uvIndex: 5, shortwaveWm2: 300 }));

    expect(summer.inputs.sunPenaltyC).toBeCloseTo(4.5, 10);
    expect(winter.inputs.sunPenaltyC).toBeCloseTo(1.5, 10);
  });

  it("caps the sun penalty at the widest gap the literature reports", () => {
    const result = heatScore(HALF_HOUR_IN_SUN, weather({ shortwaveWm2: 2000 }));

    expect(2000 * SUN_FELT_C_PER_WM2).toBeGreaterThan(MAX_SUN_FELT_C);
    expect(result.inputs.sunPenaltyC).toBe(MAX_SUN_FELT_C);
  });

  it("stops distinguishing sun from shade after dark", () => {
    const sun = heatScore(HALF_HOUR_IN_SUN, weather({ shortwaveWm2: 0 }));
    const shade = heatScore(HALF_HOUR_IN_SHADE, weather({ shortwaveWm2: 0 }));

    expect(sun.mode).toBe("felt-temperature");
    expect(sun.score).toBe(shade.score);
  });

  it("falls back to dry-bulb temperature when wind is missing", () => {
    // Without wind the apparent temperature's solar term cannot be removed, so the
    // model drops to a number that never contained one.
    const result = heatScore(HALF_HOUR_IN_SUN, weather({ windMs: null }));

    expect(result.mode).toBe("felt-temperature");
    expect(result.inputs.ambientIsApparent).toBe(false);
    expect(result.feltC as number).toBeCloseTo(31 + 4.5, 10);
    expect(result.confidence).toBeLessThan(
      heatScore(HALF_HOUR_IN_SUN, weather()).confidence
    );
  });

  it("degrades to shade-only with no forecast at all", () => {
    const result = heatScore({ sunMinutes: 12, shadeMinutes: 28 }, null);

    expect(result.mode).toBe("shade-only");
    expect(result.feltC).toBeNull();
    expect(result.score).toBe(30);
    expect(result.confidence).toBeLessThan(
      heatScore({ sunMinutes: 12, shadeMinutes: 28 }, weather()).confidence
    );
  });

  it("degrades to shade-only when the hour carries no radiation", () => {
    const result = heatScore(HALF_HOUR_IN_SUN, weather({ shortwaveWm2: null }));

    expect(result.mode).toBe("shade-only");
    expect(result.inputs.shortwaveWm2).toBeNull();
  });

  it("degrades to shade-only when the hour carries no temperature at all", () => {
    const result = heatScore(
      HALF_HOUR_IN_SUN,
      weather({ apparentTempC: null, tempC: null })
    );

    expect(result.mode).toBe("shade-only");
    expect(result.inputs.ambientC).toBeNull();
  });

  it("survives a zero-length trip without producing NaN", () => {
    const result = heatScore({ sunMinutes: 0, shadeMinutes: 0 }, weather());

    expect(result.inputs.sunFraction).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("carries its method version so the UI can link to the right page", () => {
    expect(heatScore(HALF_HOUR_IN_SUN, weather()).method).toBe("shade-radiation-v1");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  MED_SED,
  SED_PER_MINUTE_PER_UVI,
  SHADE_UV_TRANSMISSION,
  dose,
} from "../heat/dose";
import type { SkinType } from "../heat/types";

const sun = (sunMinutes: number) => ({ sunMinutes, shadeMinutes: 0 });

describe("dose — the arithmetic", () => {
  it("converts a UV index and full-sun minutes into SED", () => {
    // 1 UVI = 25 mW/m² erythemal; 1 SED = 100 J/m². 30 min at UV 8 = 3.6 SED.
    const d = dose(sun(30), 8)!;

    expect(d.sed.low).toBeCloseTo(3.6, 6);
    expect(d.sed.high).toBeCloseTo(3.6, 6);
  });

  it("keeps the documented per-minute constant", () => {
    expect(SED_PER_MINUTE_PER_UVI).toBeCloseTo((25 / 1000) * 60 / 100, 12);
  });

  it("scales linearly in both UV and time", () => {
    const base = dose(sun(20), 5)!;
    expect(dose(sun(40), 5)!.sed.low).toBeCloseTo(base.sed.low * 2, 6);
    expect(dose(sun(20), 10)!.sed.low).toBeCloseTo(base.sed.low * 2, 6);
  });
});

describe("dose — a table of known UV and skin combinations", () => {
  // Full-sun minutes to one MED = MED / (UVI × 0.015). These are the figures the
  // published rules of thumb give: fair skin, UV 8, burns in about 20 minutes.
  const cases: Array<{ uv: number; skin: SkinType; burnLow: number; burnHigh: number }> = [
    { uv: 8, skin: "II", burnLow: 16.7, burnHigh: 25.0 },
    { uv: 3, skin: "II", burnLow: 44.4, burnHigh: 66.7 },
    { uv: 11, skin: "I", burnLow: 9.1, burnHigh: 15.2 },
    { uv: 8, skin: "VI", burnLow: 66.7, burnHigh: 100.0 },
  ];

  for (const { uv, skin, burnLow, burnHigh } of cases) {
    it(`UV ${uv}, type ${skin}: burns in ${burnLow}–${burnHigh} min of full sun`, () => {
      const d = dose(sun(0), uv, { skinType: skin })!;

      expect(d.burnMinutes!.low).toBeCloseTo(burnLow, 1);
      expect(d.burnMinutes!.high).toBeCloseTo(burnHigh, 1);
    });
  }

  it("a trip lasting exactly one MED reads as one whole burn", () => {
    const d = dose(sun(MED_SED.II.low / (8 * SED_PER_MINUTE_PER_UVI)), 8)!;

    // Against the most tolerant end of the type II band it is only a partial burn.
    expect(d.burnFraction.high).toBeCloseTo(1, 6);
    expect(d.burnFraction.low).toBeLessThan(1);
  });

  it("darker skin accumulates the same dose but a smaller share of a burn", () => {
    const fair = dose(sun(30), 8, { skinType: "II" })!;
    const dark = dose(sun(30), 8, { skinType: "VI" })!;

    expect(dark.sed.low).toBeCloseTo(fair.sed.low, 6);
    expect(dark.burnFraction.high).toBeLessThan(fair.burnFraction.high);
  });
});

describe("dose — shade is not a shield", () => {
  it("charges shaded minutes a real share of the ambient rate", () => {
    const d = dose({ sunMinutes: 0, shadeMinutes: 60 }, 8)!;

    // 60 min at UV 8 in full sun would be 7.2 SED; in shade, 20–50% of that.
    expect(d.sed.low).toBeCloseTo(7.2 * SHADE_UV_TRANSMISSION.low, 6);
    expect(d.sed.high).toBeCloseTo(7.2 * SHADE_UV_TRANSMISSION.high, 6);
  });

  it("never reports a fully shaded daytime trip as zero dose", () => {
    const d = dose({ sunMinutes: 0, shadeMinutes: 90 }, 7)!;

    expect(d.sed.low).toBeGreaterThan(0);
    expect(d.burnFraction.low).toBeGreaterThan(0);
  });

  it("still prefers shade — the same minutes cost less than in the sun", () => {
    const shaded = dose({ sunMinutes: 0, shadeMinutes: 40 }, 8)!;
    const exposed = dose({ sunMinutes: 40, shadeMinutes: 0 }, 8)!;

    expect(shaded.sed.high).toBeLessThan(exposed.sed.low);
  });
});

describe("dose — honesty about what it does not know", () => {
  it("returns null when the UV index is unavailable", () => {
    // Not a zero dose: a missing forecast must never render as a safe trip.
    expect(dose(sun(45), null)).toBeNull();
    expect(dose(sun(45), Number.NaN)).toBeNull();
  });

  it("treats a measured zero as a real zero, with no burn time", () => {
    const d = dose(sun(45), 0)!;

    expect(d.sed.high).toBe(0);
    expect(d.burnMinutes).toBeNull();
  });

  it("reports every figure as an interval, never a point value", () => {
    const d = dose({ sunMinutes: 20, shadeMinutes: 20 }, 8)!;

    expect(d.sed.high).toBeGreaterThan(d.sed.low);
    expect(d.burnFraction.high).toBeGreaterThan(d.burnFraction.low);
    expect(d.burnMinutes!.high).toBeGreaterThan(d.burnMinutes!.low);
  });

  it("rates a mostly shaded trip as more uncertain than a sunlit one", () => {
    const sunlit = dose({ sunMinutes: 60, shadeMinutes: 0 }, 8)!;
    const shaded = dose({ sunMinutes: 0, shadeMinutes: 60 }, 8)!;

    expect(sunlit.uncertainty).toBe("low");
    expect(shaded.uncertainty).toBe("high");
  });

  it("carries a version so the UI can link to the method that produced it", () => {
    expect(dose(sun(10), 5)!.method).toBe("sed-uvi-v1");
  });

  it("defaults to type II and says as much through the profile", () => {
    expect(DEFAULT_PROFILE.skinType).toBe("II");
    expect(dose(sun(30), 8)).toEqual(dose(sun(30), 8, { skinType: "II" }));
  });
});

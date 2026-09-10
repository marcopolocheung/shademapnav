import { describe, expect, it } from "vitest";
import {
  MED_SED,
  SED_PER_MINUTE_PER_UVI,
  SHADOW_UV_TRANSMISSION,
  dose,
} from "../heat/dose";

const sun = (sunMinutes: number) => ({ sunMinutes, shadowMinutes: 0 });

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

describe("dose — the full-sun equivalent shown to users", () => {
  it("restates a fully sunlit trip as itself", () => {
    const d = dose(sun(25), 8)!;

    expect(d.fullSunEquivalentMinutes.low).toBeCloseTo(25, 6);
    expect(d.fullSunEquivalentMinutes.high).toBeCloseTo(25, 6);
  });

  it("counts shadowed minutes at the transmission band, not at zero", () => {
    const d = dose({ sunMinutes: 0, shadowMinutes: 60 }, 8)!;

    expect(d.fullSunEquivalentMinutes.low).toBeCloseTo(60 * SHADOW_UV_TRANSMISSION.low, 6);
    expect(d.fullSunEquivalentMinutes.high).toBeCloseTo(60 * SHADOW_UV_TRANSMISSION.high, 6);
  });

  it("is independent of the UV index — it is a duration, not a dose", () => {
    const trip = { sunMinutes: 20, shadowMinutes: 20 };

    expect(dose(trip, 3)!.fullSunEquivalentMinutes.high).toBeCloseTo(
      dose(trip, 11)!.fullSunEquivalentMinutes.high,
      6
    );
  });
});

describe("dose — a burn fraction needs a real person", () => {
  it("withholds a burn fraction when no profile is supplied", () => {
    // The whole point: nothing may default a skin type into existence. Fitzpatrick
    // type predicts measured MED at only r ≈ 0.5–0.69 (see docs/notes/heat-model.md).
    expect(dose(sun(30), 8)!.burnFraction).toBeNull();
    expect(dose(sun(30), 8, null)!.burnFraction).toBeNull();
  });

  it("computes one against the phototype band when a caller does supply a profile", () => {
    const d = dose(sun(30), 8, { skinType: "II" })!;

    // 3.6 SED against a 2.0–3.0 SED band for type II.
    expect(d.burnFraction!.low).toBeCloseTo(3.6 / 3.0, 6);
    expect(d.burnFraction!.high).toBeCloseTo(3.6 / 2.0, 6);
  });

  it("keeps the dose identical across skin types — only the share of a burn moves", () => {
    const fair = dose(sun(30), 8, { skinType: "II" })!;
    const dark = dose(sun(30), 8, { skinType: "VI" })!;

    expect(dark.sed.low).toBeCloseTo(fair.sed.low, 6);
    expect(dark.burnFraction!.high).toBeLessThan(fair.burnFraction!.high);
  });

  it("keeps the phototype table ordered and non-overlapping enough to be usable", () => {
    const types = ["I", "II", "III", "IV", "V", "VI"] as const;
    for (let i = 1; i < types.length; i++) {
      expect(MED_SED[types[i]].low).toBeGreaterThanOrEqual(MED_SED[types[i - 1]].low);
    }
  });
});

describe("dose — shadow is not a shield", () => {
  it("charges shadowed minutes a real share of the ambient rate", () => {
    const d = dose({ sunMinutes: 0, shadowMinutes: 60 }, 8)!;

    // 60 min at UV 8 in full sun would be 7.2 SED; in shadow, 20–60% of that.
    expect(d.sed.low).toBeCloseTo(7.2 * SHADOW_UV_TRANSMISSION.low, 6);
    expect(d.sed.high).toBeCloseTo(7.2 * SHADOW_UV_TRANSMISSION.high, 6);
  });

  it("never reports a fully shadowed daytime trip as zero dose", () => {
    const d = dose({ sunMinutes: 0, shadowMinutes: 90 }, 7)!;

    expect(d.sed.low).toBeGreaterThan(0);
    expect(d.fullSunEquivalentMinutes.low).toBeGreaterThan(0);
  });

  it("still prefers shadow — the same minutes cost less than in the sun", () => {
    const shadowed = dose({ sunMinutes: 0, shadowMinutes: 40 }, 8)!;
    const exposed = dose({ sunMinutes: 40, shadowMinutes: 0 }, 8)!;

    expect(shadowed.sed.high).toBeLessThan(exposed.sed.low);
  });
});

describe("dose — honesty about what it does not know", () => {
  it("returns null when the UV index is unavailable", () => {
    // Not a zero dose: a missing forecast must never render as a safe trip.
    expect(dose(sun(45), null)).toBeNull();
    expect(dose(sun(45), Number.NaN)).toBeNull();
  });

  it("treats a measured zero as a real zero", () => {
    const d = dose(sun(45), 0)!;

    expect(d.sed.high).toBe(0);
    expect(d.fullSunEquivalentMinutes.high).toBe(0);
  });

  it("reports every figure as an interval, never a point value", () => {
    const d = dose({ sunMinutes: 20, shadowMinutes: 20 }, 8, { skinType: "II" })!;

    expect(d.sed.high).toBeGreaterThan(d.sed.low);
    expect(d.fullSunEquivalentMinutes.high).toBeGreaterThan(d.fullSunEquivalentMinutes.low);
    expect(d.burnFraction!.high).toBeGreaterThan(d.burnFraction!.low);
  });

  it("rates a mostly shadowed trip as more uncertain than a sunlit one", () => {
    const sunlit = dose({ sunMinutes: 60, shadowMinutes: 0 }, 8)!;
    const shadowed = dose({ sunMinutes: 0, shadowMinutes: 60 }, 8)!;

    expect(sunlit.uncertainty).toBe("low");
    expect(shadowed.uncertainty).toBe("high");
  });

  it("reports the transmission band the documented derivation uses", () => {
    // Clear-sky diffuse is 50-62% of global erythemal UV; this band is that share
    // times a street's sky view fraction. Changing it changes every shown number,
    // so it is pinned here and explained in docs/notes/heat-model.md.
    expect(SHADOW_UV_TRANSMISSION).toEqual({ low: 0.2, high: 0.6 });
  });

  it("carries a version so the UI can link to the method that produced it", () => {
    expect(dose(sun(10), 5)!.method).toBe("sed-uvi-v1");
  });

  it("never invents a person to describe", () => {
    // An earlier draft defaulted to skin type II and rendered "16-29% of a burn"
    // for a user nobody had asked. The default must stay absent.
    expect(dose(sun(30), 8)!.burnFraction).toBeNull();
  });
});

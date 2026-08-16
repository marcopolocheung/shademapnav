import { describe, expect, it } from "vitest";
import { bestExposureSample, buildHourlyExposureSeries } from "../bestTime";
import { toMapLocal } from "../timezone";

describe("buildHourlyExposureSeries", () => {
  it("samples map-local hours on the same map-local date", () => {
    const baseDate = new Date("2026-07-05T12:00:00.000Z");
    const samples = buildHourlyExposureSeries(
      baseDate,
      -300,
      (date) => (toMapLocal(date, -300).hours === 8 ? 0.75 : 0.25),
      { startHour: 7, endHour: 9 }
    );

    expect(samples.map((sample) => sample.hour)).toEqual([7, 8, 9]);
    expect(samples.map((sample) => sample.label)).toEqual(["7 AM", "8 AM", "9 AM"]);
    expect(samples[1].shadeCoverage).toBe(0.75);
    expect(samples[1].sunExposure).toBe(0.25);
  });

  it("clamps shade coverage and chooses the lowest exposure sample", () => {
    const baseDate = new Date("2026-07-05T12:00:00.000Z");
    const samples = buildHourlyExposureSeries(
      baseDate,
      540,
      (date) => {
        const hour = toMapLocal(date, 540).hours;
        if (hour === 10) return 1.5;
        if (hour === 11) return -0.5;
        return 0.4;
      },
      { startHour: 9, endHour: 11 }
    );

    expect(samples.map((sample) => sample.shadeCoverage)).toEqual([0.4, 1, 0]);
    expect(bestExposureSample(samples)?.label).toBe("10 AM");
  });

  it("rejects invalid hour ranges", () => {
    const baseDate = new Date("2026-07-05T12:00:00.000Z");

    expect(() =>
      buildHourlyExposureSeries(baseDate, 0, () => 0.5, { startHour: 12, endHour: 10 })
    ).toThrow(/endHour/);
    expect(() =>
      buildHourlyExposureSeries(baseDate, 0, () => 0.5, { stepHours: 0 })
    ).toThrow(/stepHours/);
  });
});

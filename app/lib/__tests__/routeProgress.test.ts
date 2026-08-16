import { describe, expect, it } from "vitest";
import { routeProgressCount, routeProgressPercent } from "../routeProgress";

describe("route progress formatting", () => {
  it("returns null when progress has no bounded total", () => {
    expect(routeProgressPercent({ message: "Fetching" })).toBeNull();
    expect(routeProgressCount({ message: "Fetching", current: 1, total: 0 })).toBeNull();
  });

  it("formats bounded progress for visible and aria progress bars", () => {
    const progress = { message: "Sampling street shade", current: 25, total: 100 };

    expect(routeProgressPercent(progress)).toBe(25);
    expect(routeProgressCount(progress)).toBe("25/100");
  });

  it("clamps progress to the known range", () => {
    const progress = { message: "Sampling street shade", current: 120, total: 100 };

    expect(routeProgressPercent(progress)).toBe(100);
    expect(routeProgressCount(progress)).toBe("100/100");
  });
});

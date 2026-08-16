import { describe, expect, it } from "vitest";
import { getTravelModePolicy, travelTimeSeconds } from "../travelMode";

describe("travel mode policy", () => {
  it("keeps the existing walking speed centralized", () => {
    expect(getTravelModePolicy("walk").speedMps).toBe(1.4);
    expect(travelTimeSeconds(140, "walk")).toBeCloseTo(100);
  });

  it("defines bike as the first non-walking mode with route cost knobs", () => {
    const bike = getTravelModePolicy("bike");

    expect(bike.speedMps).toBeGreaterThan(getTravelModePolicy("walk").speedMps);
    expect(bike.stepsPenaltyM).toBeGreaterThan(0);
    expect(bike.roughSurfacePenaltyM).toBeGreaterThan(0);
    expect(bike.cyclewayPreferenceM).toBeLessThan(0);
  });
});

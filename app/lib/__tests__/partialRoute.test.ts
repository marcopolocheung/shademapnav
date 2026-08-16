import { describe, expect, it } from "vitest";
import { partialRouteNotice } from "../partialRoute";

describe("partialRouteNotice", () => {
  it("names the failed leg and completed fallback distance honestly", () => {
    expect(partialRouteNotice({ completedLegs: 3, failedLeg: 4, totalLegs: 5 }))
      .toBe("Could not finish leg 4 of 5; showing 3 completed legs.");
  });

  it("uses singular wording for one completed leg", () => {
    expect(partialRouteNotice({ completedLegs: 1, failedLeg: 2, totalLegs: 4 }))
      .toBe("Could not finish leg 2 of 4; showing 1 completed leg.");
  });
});

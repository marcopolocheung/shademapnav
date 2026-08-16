import { describe, expect, it } from "vitest";
import { computeBuildingShadeFraction } from "../shadow/offscreenShade";

describe("computeBuildingShadeFraction", () => {
  it("returns sunlit when daytime has no fetched buildings", () => {
    const shade = computeBuildingShadeFraction(
      -74,
      40.7,
      new Date("2026-08-08T18:00:00Z"),
      []
    );

    expect(shade).toBe(0);
  });

  it("treats nighttime as fully shaded", () => {
    const shade = computeBuildingShadeFraction(
      -74,
      40.7,
      new Date("2026-08-08T04:00:00Z"),
      []
    );

    expect(shade).toBe(1);
  });
});

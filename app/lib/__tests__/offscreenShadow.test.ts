import { describe, expect, it } from "vitest";
import { computeBuildingShadowFraction } from "../shadow/offscreenShadow";

describe("computeBuildingShadowFraction", () => {
  it("returns sunlit when daytime has no fetched buildings", () => {
    const shadow = computeBuildingShadowFraction(
      -74,
      40.7,
      new Date("2026-08-08T18:00:00Z"),
      []
    );

    expect(shadow).toBe(0);
  });

  it("treats nighttime as fully shadowed", () => {
    const shadow = computeBuildingShadowFraction(
      -74,
      40.7,
      new Date("2026-08-08T04:00:00Z"),
      []
    );

    expect(shadow).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { nearestCloudCover } from "../weather";

describe("nearestCloudCover", () => {
  it("returns the nearest hourly cloud cover sample", () => {
    const result = nearestCloudCover(
      {
        hourly: {
          time: ["2026-08-08T14:00", "2026-08-08T15:00", "2026-08-08T16:00"],
          cloud_cover: [15, 74, 90],
        },
      },
      new Date("2026-08-08T15:20:00.000Z")
    );

    expect(result?.cloudCoverPct).toBe(74);
    expect(result?.forecastTime.toISOString()).toBe("2026-08-08T15:00:00.000Z");
  });

  it("clamps cloud cover into a displayable percent", () => {
    const result = nearestCloudCover(
      { hourly: { time: ["2026-08-08T15:00"], cloud_cover: [120] } },
      new Date("2026-08-08T15:00:00.000Z")
    );

    expect(result?.cloudCoverPct).toBe(100);
  });

  it("returns null when the forecast window does not cover the target hour", () => {
    const result = nearestCloudCover(
      { hourly: { time: ["2026-08-08T15:00"], cloud_cover: [80] } },
      new Date("2026-08-08T20:00:00.000Z")
    );

    expect(result).toBeNull();
  });
});

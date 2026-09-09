import { describe, it, expect } from "vitest";
import { ensureZoneLookup, zoneAt } from "../tzLookup";

describe("tzLookup", () => {
  it("returns null before the dataset has loaded", () => {
    // Runs first: proves the app has a defined answer during the async window
    // rather than throwing on a null lookup.
    expect(zoneAt(40.7128, -74.006)).toBeNull();
  });

  it("resolves real zones once loaded", async () => {
    await ensureZoneLookup();
    // Also the interop check: the package is CJS (`export = tz_lookup`), so a
    // build that mishandles the default import fails here, not in production.
    expect(zoneAt(40.7128, -74.006)).toBe("America/New_York");
    expect(zoneAt(28.6139, 77.209)).toBe("Asia/Kolkata");
    expect(zoneAt(-33.8688, 151.2093)).toBe("Australia/Sydney");
  });

  it("returns null for coordinates the dataset rejects", async () => {
    await ensureZoneLookup();
    expect(zoneAt(91, 0)).toBeNull();
    expect(zoneAt(Number.NaN, 0)).toBeNull();
  });
});

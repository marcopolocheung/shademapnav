import { describe, expect, it } from "vitest";
import { acquisitionAt, acquisitionDatesIn, hasAcquisitionIndex } from "../acqDate";

const MADRID: [number, number] = [-3.7038, 40.4168];
const SINGAPORE: [number, number] = [103.8198, 1.3521];
const KENT_WA: [number, number] = [-122.2348, 47.3809];
/** Mid-Atlantic — a real place with no canopy tile in this build's index. */
const UNINDEXED: [number, number] = [-30, 35];

describe("acquisitionAt", () => {
  it("answers for each of the three A3 corpus centres", () => {
    for (const [lon, lat] of [MADRID, SINGAPORE, KENT_WA]) {
      const acquisition = acquisitionAt(lon, lat);
      expect(acquisition).not.toBeNull();
      expect(acquisition?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /**
   * The finding this whole module exists for: Madrid's canopy is measured from
   * *winter* imagery, in a city planted with deciduous planes. A8c must not quote
   * a Madrid canopy number without carrying this date alongside it.
   */
  it("reports leaf-off February imagery over Madrid", () => {
    const acquisition = acquisitionAt(MADRID[0], MADRID[1]);
    expect(acquisition?.date.slice(0, 7)).toBe("2020-02");
    expect(acquisition?.quadkey).toBe("0331110121");
  });

  it("reports leaf-on summer imagery over Kent, WA", () => {
    const acquisition = acquisitionAt(KENT_WA[0], KENT_WA[1]);
    expect(acquisition?.date.slice(0, 4)).toBe("2019");
    expect(Number(acquisition?.date.slice(5, 7))).toBeGreaterThanOrEqual(7);
    expect(Number(acquisition?.date.slice(5, 7))).toBeLessThanOrEqual(8);
  });

  it("returns null where this build has no index, rather than guessing", () => {
    expect(acquisitionAt(UNINDEXED[0], UNINDEXED[1])).toBeNull();
    expect(hasAcquisitionIndex(UNINDEXED[0], UNINDEXED[1])).toBe(false);
  });

  /**
   * One tile is not one date. Singapore's single COG is a mosaic of thirty
   * imagery footprints spanning five years, so a per-tile `observationDate` would
   * be wrong there by up to five years — which is why the index is spatial.
   */
  it("resolves different dates within Singapore's one tile", () => {
    const dates = acquisitionDatesIn("1322322311");
    expect(dates.length).toBeGreaterThan(20);
    expect(dates[0] < dates[dates.length - 1]).toBe(true);

    const seen = new Set<string>();
    // A degree of longitude either side of the corpus centre, along the tile.
    for (let step = -12; step <= 12; step++) {
      const acquisition = acquisitionAt(SINGAPORE[0] + step * 0.01, SINGAPORE[1] + step * 0.005);
      if (acquisition) seen.add(acquisition.date);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("spans years within that one tile, not months", () => {
    const dates = acquisitionDatesIn("1322322311");
    const years = new Set(dates.map((d) => d.slice(0, 4)));
    expect(years.size).toBeGreaterThanOrEqual(4);
  });

  it("knows nothing about a tile it does not carry", () => {
    expect(acquisitionDatesIn("0000000000")).toEqual([]);
  });

  it("is stable across repeated lookups, which take the cached grid path", () => {
    const first = acquisitionAt(MADRID[0], MADRID[1]);
    const second = acquisitionAt(MADRID[0], MADRID[1]);
    expect(second).toEqual(first);
  });
});

import { describe, expect, it, vi } from "vitest";
import { migrateBrowserStorage, migrateStorage } from "../storageMigration";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
  };
}
const route = {
  id: "unchanged-id", name: "My shaded ShadeMap walk", createdAt: 12345,
  waypointALabel: "Shade Street", dateIso: "2026-09-09", folderId: "f1",
  waypointA: [1, 2], waypointB: [3, 4], additionalWaypoints: [],
  routeOption: {
    label: "Most shaded", shadeCoverage: 0.75, longestContinuousShadeM: 200,
    shadeTransitions: 3, shadeSource: { dominant: "tiles", bySource: { tiles: 1 } },
    geojson: { type: "Feature", properties: { name: "shaded park", shade: "user content" },
      geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } },
    legs: [{ type: "walk", shadeCoverage: 0.6, lineName: "Shade line" }],
  },
};

describe("browser storage compatibility", () => {
  it("converts route schema and generated categories without replacing user content", () => {
    const storage = memoryStorage({ "shademapnav:routes": JSON.stringify([route]) });
    migrateStorage(storage);
    const [saved] = JSON.parse(storage.getItem("umbra:routes")!);
    expect(saved).toEqual({ ...route, routeOption: {
      label: "Most shadowed", shadowCoverage: 0.75, longestContinuousShadowM: 200,
      shadowTransitions: 3, shadowSource: route.routeOption.shadeSource,
      geojson: route.routeOption.geojson,
      legs: [{ type: "walk", shadowCoverage: 0.6, lineName: "Shade line" }],
    } });
    expect(storage.getItem("shademapnav:routes")).toBeNull();
    const before = storage.getItem("umbra:routes");
    migrateStorage(storage);
    expect(storage.getItem("umbra:routes")).toBe(before);
  });

  it("moves all preferences and session data and preserves IDs and names", () => {
    const entries = {
      folders: [{ id: "f1", name: "Shade trips", createdAt: 123 }],
      recentSearches: [{ label: "Shade Road", center: [1, 2], zoom: 14 }],
      savedPlaces: [{ label: "Shaded park", center: [3, 4], zoom: 16 }],
      shadeLegendDismissed: 1,
      foursquareAuthBlocked: { sig: "key-signature", ts: 1234 },
    };
    const storage = memoryStorage(Object.fromEntries(Object.entries(entries)
      .map(([key, value]) => [`shademapnav:${key}`, JSON.stringify(value)])));
    migrateStorage(storage);
    for (const [key, value] of Object.entries(entries)) {
      expect(JSON.parse(storage.getItem(`umbra:${key === "shadeLegendDismissed" ? "shadowLegendDismissed" : key}`)!)).toEqual(value);
      expect(storage.getItem(`shademapnav:${key}`)).toBeNull();
    }
  });

  it("prefers valid Umbra data, including an intentionally empty collection", () => {
    const storage = memoryStorage({ "shademapnav:routes": JSON.stringify([route]), "umbra:routes": "[]" });
    migrateStorage(storage);
    migrateStorage(storage);
    expect(storage.getItem("umbra:routes")).toBe("[]");
    expect(storage.getItem("shademapnav:routes")).not.toBeNull();
  });

  it.each(["{broken", "null", "{}", '[{"name":"incomplete"}]'])("recovers invalid destination %s", (invalid) => {
    const storage = memoryStorage({ "shademapnav:routes": JSON.stringify([route]), "umbra:routes": invalid });
    migrateStorage(storage);
    expect(JSON.parse(storage.getItem("umbra:routes")!)[0].id).toBe(route.id);
  });

  it("retains malformed legacy data and continues migrating other entries", () => {
    const storage = memoryStorage({ "shademapnav:routes": "{broken", "shademapnav:folders": "[]" });
    expect(() => migrateStorage(storage)).not.toThrow();
    expect(storage.getItem("shademapnav:routes")).toBe("{broken");
    expect(storage.getItem("umbra:folders")).toBe("[]");
  });

  it("retains recoverable legacy data when writes fail, then retries successfully", () => {
    const storage = memoryStorage({ "shademapnav:routes": JSON.stringify([route]) });
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => migrateStorage(storage)).not.toThrow();
    expect(storage.getItem("shademapnav:routes")).toBe(JSON.stringify([route]));
    write.mockRestore();
    migrateStorage(storage);
    expect(storage.getItem("umbra:routes")).not.toBeNull();
  });

  it("does not prevent startup when storage is unavailable", () => {
    vi.stubGlobal("window", Object.defineProperties({}, {
      localStorage: { get() { throw new Error("denied"); } },
      sessionStorage: { get() { throw new Error("denied"); } },
    }));
    expect(migrateBrowserStorage).not.toThrow();
    vi.unstubAllGlobals();
  });
});

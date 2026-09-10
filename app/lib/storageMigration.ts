/** Same-origin compatibility for browser data written before the Umbra rename. */
const LEGACY_PREFIX = "shademapnav:";
const PREFIX = "umbra:";

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Only application-owned fields are converted. Names, labels entered by users,
// GeoJSON properties, geometry, IDs and timestamps are never text-replaced.
function convertRouteOption(value: unknown): unknown {
  if (!record(value)) return value;
  const next = { ...value };
  const fields = {
    shadeCoverage: "shadowCoverage",
    longestContinuousShadeM: "longestContinuousShadowM",
    shadeTransitions: "shadowTransitions",
    shadeSource: "shadowSource",
  };
  for (const [oldKey, newKey] of Object.entries(fields)) {
    if (oldKey in next) {
      if (!(newKey in next)) next[newKey] = next[oldKey];
      delete next[oldKey];
    }
  }
  // RouteOption.label is a generated route category, unlike SavedRoute.name.
  if (next.label === "Most shaded") next.label = "Most shadowed";
  if (Array.isArray(next.legs)) next.legs = next.legs.map(convertRouteOption);
  return next;
}

function validData(suffix: string, value: unknown): boolean {
  if (["routes", "folders", "recentSearches", "savedPlaces"].includes(suffix)) {
    if (!Array.isArray(value)) return false;
    if (suffix === "routes") return value.every((item) =>
      record(item) && typeof item.id === "string" && typeof item.name === "string" &&
      record(item.routeOption) && record(item.routeOption.geojson) &&
      typeof (item.routeOption.shadowCoverage ?? item.routeOption.shadeCoverage) === "number");
    return value.every(record);
  }
  if (suffix === "shadowLegendDismissed") return value === 1;
  if (suffix === "foursquareAuthBlocked") return value === 1 ||
    (record(value) && typeof value.sig === "string" && typeof value.ts === "number");
  return true;
}

/** Retryable and idempotent: remove a legacy entry only after a successful write. */
export function migrateStorage(storage: Storage): void {
  let keys: string[];
  try {
    keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
      .filter((key): key is string => key?.startsWith(LEGACY_PREFIX) === true);
  } catch { return; }
  for (const oldKey of keys) {
    try {
      const suffix = oldKey.slice(LEGACY_PREFIX.length).replace(/^shadeLegendDismissed$/, "shadowLegendDismissed");
      const newKey = PREFIX + suffix;
      const raw = storage.getItem(oldKey);
      if (raw === null) continue;
      const value: unknown = JSON.parse(raw);
      if (!validData(suffix, value)) continue;
      const existing = storage.getItem(newKey);
      if (existing !== null) {
        try {
          if (validData(suffix, JSON.parse(existing))) continue;
        } catch { /* Recover an invalid destination from the legacy entry. */ }
      }
      const converted = suffix === "routes" && Array.isArray(value)
        ? value.map((item) => ({ ...item, routeOption: convertRouteOption(item.routeOption) }))
        : value;
      storage.setItem(newKey, JSON.stringify(converted));
      storage.removeItem(oldKey);
    } catch { /* Storage denial, quota or malformed JSON must not stop startup. */ }
  }
}

export function migrateBrowserStorage(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try { migrateStorage(window[name]); } catch { /* Unavailable browser storage. */ }
  }
}

// Dependency evaluation precedes application modules' storage reads.
migrateBrowserStorage();

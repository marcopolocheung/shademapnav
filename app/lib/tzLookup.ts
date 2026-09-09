/**
 * lat/lng → IANA zone name, from a boundary dataset loaded on demand.
 *
 * Split out of `timezone.ts` for two reasons: that module stays pure and its
 * tests need no dataset, and the ~29 kB of boundary data lands in its own async
 * chunk instead of the entry bundle. Nothing here is needed to render the first
 * frame — the app runs on a longitude estimate until this resolves.
 *
 * The offset *rules* are not here: they come from the runtime's tz database via
 * `utcOffsetMinAt`. This only answers "which zone is that point in".
 */

type ZoneLookup = (lat: number, lng: number) => string;

let lookup: ZoneLookup | null = null;
let loading: Promise<void> | null = null;

/**
 * Load the dataset once. Idempotent and safe to call on every map move — after
 * the first call this is a resolved promise, and `zoneAt` is synchronous.
 */
export function ensureZoneLookup(): Promise<void> {
  if (lookup) return Promise.resolve();
  if (!loading) {
    loading = import("@photostructure/tz-lookup")
      .then((mod) => {
        lookup = mod.default;
      })
      .catch(() => {
        // Offline, or the chunk failed to load. Callers fall back to longitude;
        // retry on the next call rather than latching the failure forever.
        loading = null;
      });
  }
  return loading;
}

/**
 * The IANA zone containing a point, or `null` before the dataset has loaded and
 * for coordinates the dataset rejects.
 *
 * Synchronous by design: it is read inside a `useMemo` on every date change.
 */
export function zoneAt(lat: number, lng: number): string | null {
  if (!lookup) return null;
  try {
    return lookup(lat, lng);
  } catch {
    return null; // the package throws on out-of-range coordinates
  }
}
